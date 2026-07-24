import { test, expect } from "@playwright/test";
import { expectMapLoaded } from "./map-loaded";
import { stubExternalMapAssets } from "./map-network";

test.describe("Map time range slider", () => {
  test.beforeEach(async ({ page }) => {
    await stubExternalMapAssets(page);
  });

  test("clear dates removes the range and URL params", async ({ page }) => {
    await page.goto("/map?from=2020-01-01&to=2025-01-01", {
      waitUntil: "domcontentloaded",
    });

    // The slider is page chrome: it renders, clears and rewrites the URL even
    // when the map beside it is a blank canvas. Filtering a map nobody can see
    // is not the feature, so require a live map before exercising the control.
    await expectMapLoaded(page);

    const clearButton = page.getByRole("button", { name: "Clear date filter" });
    await expect(clearButton).toBeVisible({ timeout: 10_000 });
    await clearButton.click();

    // Clear action disappears
    await expect(clearButton).not.toBeVisible({ timeout: 5_000 });

    // URL should no longer have from/to
    await page.waitForFunction(
      () =>
        !new URL(window.location.href).searchParams.has("from") &&
        !new URL(window.location.href).searchParams.has("to"),
    );
  });
});
