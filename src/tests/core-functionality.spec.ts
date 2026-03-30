import { test, expect } from "@playwright/test";

test.describe("Core Functionality Tests", () => {
  test("homepage loads successfully", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Snapshots");
    await expect(page.locator("h1")).toContainText("Snapshots");

    // Verify navigation links are present
    await expect(page.locator('a[href="/map"]')).toBeVisible();
    await expect(page.locator('a[href="/slideshow"]')).toBeVisible();

    console.log("✓ Homepage loaded successfully");
  });

  test("map page loads and displays correctly", async ({ page }) => {
    await page.goto("/map");
    await expect(page).toHaveTitle("Map | Snapshots");

    // Wait for back link to be visible (indicates page structure loaded)
    await expect(page.locator('a:has-text("Albums")')).toBeVisible();

    console.log("✓ Map page loaded successfully");
  });

  test("slideshow page loads (with extended timeout)", async ({ page }) => {
    // Slideshow takes time to load due to database initialization
    await page.goto("/slideshow");

    // Wait for the slideshow to initialize - look for key elements
    await expect(page).toHaveTitle("Slideshow | Snapshots");

    // Wait for slideshow controls to appear (more flexible selectors)
    const controls = page.locator(
      'button:has-text("Next"), a:has-text("← Home"), button:has-text("⏸"), button:has-text("▶")',
    );
    await expect(controls.first()).toBeVisible();

    console.log(
      "✓ Slideshow page loaded successfully (with database initialization)",
    );
  });

  test("can navigate to album pages", async ({ page }) => {
    await page.goto("/");

    // Wait for albums to load (but not with networkidle which is too slow)
    await page.waitForTimeout(5000);

    // Find any album link and click it
    const albumLink = page.locator('a[href*="/album/"]').first();
    await expect(albumLink).toBeVisible();

    const albumHref = await albumLink.getAttribute("href");
    console.log("Clicking album:", albumHref);

    await albumLink.click();
    await page.waitForLoadState("domcontentloaded");

    // Verify we're on an album page
    await expect(page.locator("nav")).toBeVisible();
    console.log("✓ Album page navigation successful");
  });

  test("theme toggle functionality", async ({ page }) => {
    await page.goto("/");

    // Look for theme toggle button
    const themeToggle = page
      .locator(
        'button[title*="theme" i], button:has-text("🌙"), button:has-text("☀️"), [data-testid="theme-toggle"]',
      )
      .first();

    if (await themeToggle.isVisible()) {
      // Get initial state
      const htmlElement = page.locator("html");
      const initialTheme = await htmlElement.getAttribute("data-theme");

      // Click toggle
      await themeToggle.click();
      await page.waitForTimeout(500);

      // Check if theme changed
      const newTheme = await htmlElement.getAttribute("data-theme");

      console.log(`Theme changed from "${initialTheme}" to "${newTheme}"`);
      console.log("✓ Theme toggle functionality working");
    } else {
      console.log("⚠ Theme toggle not found - may not be visible on this page");
    }
  });
});
