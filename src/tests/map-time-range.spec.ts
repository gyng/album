import { test, expect } from "@playwright/test";
import { stubExternalMapAssets } from "./map-network";

test.describe("Map time range slider", () => {
  test.beforeEach(async ({ page }) => {
    await stubExternalMapAssets(page);
  });

  test("clear dates removes the range and URL params", async ({ page }) => {
    await page.goto("/map?from=2020-01-01&to=2025-01-01", {
      waitUntil: "domcontentloaded",
    });

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
