import { test, expect } from "@playwright/test";

test.describe("Core Functionality", () => {
  test("homepage loads", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Snapshots");
    await expect(page.locator('a[href*="/album/"]').first()).toBeVisible();
  });

  test("main pages are accessible", async ({ page }) => {
    // Map
    await page.goto("/map");
    await expect(page).toHaveTitle("Map");

    // Search
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: /search & explore/i })).toBeVisible();

    // Timeline
    await page.goto("/timeline");
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  });
});
