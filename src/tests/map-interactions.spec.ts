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
});
