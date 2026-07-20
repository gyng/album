import { expect, test } from "@playwright/test";
import { stubExternalMapAssets } from "./map-network";

test.describe("World map interactions", () => {
  test.beforeEach(async ({ page }) => {
    await stubExternalMapAssets(page);
    await page.goto("/map", { waitUntil: "domcontentloaded" });
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
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
    await expect(
      page.getByRole("button", { name: /Photo from test-simple/i }).first(),
    ).toBeVisible();

    await input.fill("a phrase that cannot exist in the fixture archive");
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
    const distanceLegend = page.locator(
      ".maplibregl-ctrl-bottom-left .maplibregl-ctrl-scale",
    );
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

    const previewLabel = page
      .getByRole("button", { name: /Photo from test-simple/i })
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
