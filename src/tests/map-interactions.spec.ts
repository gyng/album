import { expect, type Locator, type Page, test } from "@playwright/test";
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
    await page.goto("/map", { waitUntil: "domcontentloaded" });
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

  test("switches the basemap to another of the provider's styles, and remembers it", async ({
    page,
  }) => {
    // The picker sits in the nav between the search field and the site theme —
    // the two appearance choices together. Every option is the same provider and
    // key as the default, so the swap needs no new credential and carries its own
    // attribution, and the port applies it with `setStyle` and re-adds our
    // layers, so the pins survive the change.
    const picker = page.getByRole("combobox", { name: "Map style" });
    await expect(picker).toHaveValue("default");

    const styleRequest = page.waitForRequest((request) =>
      request.url().includes("/maps/aquarelle"),
    );
    await picker.selectOption("watercolour");
    await styleRequest;
    await expect(page.locator('[data-map-status="loaded"]')).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("combobox", { name: "Map style" })).toHaveValue("watercolour");
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
