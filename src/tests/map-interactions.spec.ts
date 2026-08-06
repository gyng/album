import { expect, type Locator, type Page, test } from "@playwright/test";
import { gotoHydrated, waitForHydration } from "./hydrated";
import { stubExternalMapAssets } from "./map-network";

/**
 * A photo pin the reader can see on the map.
 *
 * An accessible name is no longer enough to pick one out: pins drawn on the GPU
 * have no element of their own, so the map also offers the photos in view as a
 * visually hidden list of buttons carrying exactly the same name. Both are real
 * affordances and both should keep their names — but only one of them is a pin
 * with a marker around it, and these tests are about the pin.
 */
const mapPin = (page: Page, name: RegExp): Locator =>
  page.getByRole("button", { name }).and(page.locator("[data-map-pin]"));

test.describe("World map interactions", () => {
  test.beforeEach(async ({ page }) => {
    await stubExternalMapAssets(page);
    await gotoHydrated(page, "/map");
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
  });

  test("keeps the search field still while the result count changes under it", async ({ page }) => {
    // The count sits beside the field and the Fit/Tour actions hang below the
    // box, precisely so neither can move or resize the field. Typing swings the
    // count between "N photos", "N/M" and "No matches"; an earlier version of
    // this box grew 273→362px and reflowed 2→3 rows on a keystroke, and the
    // first cut of this one slid 8px sideways because a flex item's default
    // `min-width: auto` let the longest count push past its own width.
    const input = page.getByRole("searchbox", { name: "Search photos on the map" });
    const count = page.getByRole("status");
    const field = page.locator('[role="search"]');

    await expect(count).toHaveText(/photos$/);
    const box = await field.boundingBox();
    const countBox = await count.boundingBox();

    const indexResponse = page.waitForResponse((response) =>
      response.url().includes("map-search-index.json"),
    );
    await input.focus();
    await indexResponse;

    await input.fill("test-simple");
    await expect(count).toHaveText(/^\d+\/\d+$/);
    // The actions appear below the box rather than inside it, so the box keeps
    // its height as well as its width.
    await expect(page.getByRole("button", { name: "Fit the map to the results" })).toBeVisible();
    expect(await field.boundingBox()).toEqual(box);
    expect(await count.boundingBox()).toEqual(countBox);

    await input.fill("a phrase that cannot exist in the fixture archive");
    await expect(count).toHaveText("No matches");
    expect(await field.boundingBox()).toEqual(box);
    expect(await count.boundingBox()).toEqual(countBox);
  });

  test("switches the basemap and remembers it", async ({ page }) => {
    // The picker sits in the nav between the search field and the site theme —
    // the two appearance choices together. It opens on matching the theme, and
    // every choice is either ours or the free provider's, so no page view costs
    // a quota. The port applies a change with `setStyle` and re-adds our
    // layers, so the pins survive it.
    const picker = page.getByRole("combobox", { name: "Map style" });
    await expect(picker).toHaveValue("auto");

    const styleRequest = page.waitForRequest((request) =>
      request.url().includes("tiles.openfreemap.org/styles/dark"),
    );
    await picker.selectOption("dark");
    await styleRequest;
    await expect(page.locator('[data-map-status="loaded"]')).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await expect(page.getByRole("combobox", { name: "Map style" })).toHaveValue("dark");

    // And back: following the theme is a choice of its own, so a pinned basemap
    // is reversible.
    await page.getByRole("combobox", { name: "Map style" }).selectOption("auto");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await expect(page.getByRole("combobox", { name: "Map style" })).toHaveValue("auto");
  });

  // The legend positions itself by hand rather than sitting in a MapLibre
  // control container, so it did not follow when the date panel lifted the
  // scale and attribution: the years it explains ended up behind the histogram.
  test("the date panel clears the recency legend", async ({ page }) => {
    const legend = page.locator("[data-map-legend='recency']");
    const panel = page.locator("#map-date-controls");
    await expect(legend).toBeVisible();

    await page.getByRole("button", { name: "Choose dates" }).first().click();
    await expect(panel).toBeVisible();

    // Polled rather than measured once: the legend eases up to its new place,
    // so a single read catches it mid-flight. What matters is where it settles —
    // wholly above the panel, not merely not-centred on it.
    await expect
      .poll(async () => {
        const legendBox = await legend.boundingBox();
        const panelBox = await panel.boundingBox();
        if (!legendBox || !panelBox) return null;
        return Math.round(legendBox.y + legendBox.height - panelBox.y);
      })
      .toBeLessThanOrEqual(0);
  });

  test("filters mapped photos with the lightweight index", async ({ page }) => {
    const input = page.getByRole("searchbox", { name: "Search photos on the map" });
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some(({ name }) => name.includes("map-search-index") || name.includes("search.sqlite")),
      ),
    ).toBe(false);

    const indexResponse = page.waitForResponse((response) =>
      response.url().includes("map-search-index.json"),
    );
    await input.focus();
    await indexResponse;

    await input.fill("test-simple");
    await expect(mapPin(page, /Photo from test-simple/i).first()).toBeVisible();

    await input.fill("a phrase that cannot exist in the fixture archive");
    // Deliberately unscoped: with nothing left to show, neither a pin nor a
    // hidden keyboard entry should be offering a photo.
    await expect(page.getByRole("button", { name: /^Photo from / })).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        performance.getEntriesByType("resource").some(({ name }) => name.includes("search.sqlite")),
      ),
    ).toBe(false);
  });

  test("aligns the map legends and uses the site typeface for search previews", async ({
    page,
  }) => {
    const dateLegend = page.locator(".maplibregl-ctrl-scale").filter({
      has: page.locator("span"),
    });
    const distanceLegend = page.locator(".maplibregl-ctrl-bottom-left .maplibregl-ctrl-scale");
    const [dateLegendBox, distanceLegendBox] = await Promise.all([
      dateLegend.boundingBox(),
      distanceLegend.boundingBox(),
    ]);

    expect(dateLegendBox).not.toBeNull();
    expect(distanceLegendBox).not.toBeNull();
    expect(dateLegendBox!.x).toBeCloseTo(distanceLegendBox!.x, 0);

    const input = page.getByRole("searchbox", { name: "Search photos on the map" });
    const indexResponse = page.waitForResponse((response) =>
      response.url().includes("map-search-index.json"),
    );
    await input.focus();
    await indexResponse;
    await input.fill("test-simple");

    // The map's own chrome is held to the same typeface: MapLibre ships a
    // Helvetica stack, and the scale, the attribution and the recency legend
    // that borrows the scale's classes were the only text on the page not in the
    // site's face — which is themeable, so this follows the palette's too.
    const bodyFont = await page
      .locator("body")
      .evaluate((body) => getComputedStyle(body).fontFamily);
    for (const chrome of [".maplibregl-ctrl-scale", ".maplibregl-ctrl-attrib-inner"]) {
      expect(
        await page
          .locator(chrome)
          .first()
          .evaluate((el) => getComputedStyle(el).fontFamily),
      ).toBe(bodyFont);
    }

    const previewLabel = mapPin(page, /Photo from test-simple/i)
      .first()
      .locator("..")
      .locator('span[aria-hidden="true"]');
    await expect(previewLabel).toBeVisible();
    const typefaces = await previewLabel.evaluate((label) => ({
      body: getComputedStyle(document.body).fontFamily,
      preview: getComputedStyle(label).fontFamily,
    }));

    expect(typefaces.preview).toBe(typefaces.body);
  });
});

test.describe("Map chrome inside the photo details panel", () => {
  // The attribution's (i) is a <summary>, and the details panel the mini-map
  // sits inside styles `summary` by descent for its own disclosures. That
  // reached into the map: a 44px tap target on a button pinned to the top of a
  // 24px bar put the (i) 10px below the bar's centre. Measured in a browser
  // because a cascade is the thing under test.
  test("centres the attribution button in its bar", async ({ page }) => {
    await stubExternalMapAssets(page);
    await gotoHydrated(page, "/album/test-simple");

    await page.locator('summary[aria-label="Photo details"]').first().click();
    const button = page.locator(".maplibregl-ctrl-attrib-button").first();
    await expect(button).toBeVisible();

    const geometry = await button.evaluate((element) => {
      const bar = element.closest(".maplibregl-ctrl-attrib")!.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return {
        offset: box.top + box.height / 2 - (bar.top + bar.height / 2),
        height: box.height,
        barHeight: bar.height,
      };
    });

    expect(geometry.height).toBe(geometry.barHeight);
    expect(geometry.offset).toBe(0);
  });
});
