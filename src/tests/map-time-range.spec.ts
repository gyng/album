import { test, expect } from "@playwright/test";

test.describe("Map time range slider", () => {
  test("slider renders with two thumbs and sparkline", async ({ page }) => {
    await page.goto("/map");

    // Two slider thumbs (from + to)
    const sliders = page.locator('[role="slider"]');
    await expect(sliders.first()).toBeVisible({ timeout: 10_000 });
    expect(await sliders.count()).toBe(2);

    // Sparkline SVG
    await expect(page.locator('svg[class*="sparkline"]')).toBeVisible();

    // Date labels
    const labels = page.locator('[class*="label"]');
    expect(await labels.count()).toBeGreaterThanOrEqual(2);
  });

  test("URL params activate range and show reset", async ({ page }) => {
    await page.goto("/map?from=2020-01-01&to=2025-01-01");

    const sliders = page.locator('[role="slider"]');
    await expect(sliders.first()).toBeVisible({ timeout: 10_000 });

    // Reset button appears when range is active
    const resetButton = page.locator('button:has-text("Reset")');
    await expect(resetButton).toBeVisible();
  });

  test("reset clears range and removes URL params", async ({ page }) => {
    await page.goto("/map?from=2020-01-01&to=2025-01-01");

    const resetButton = page.locator('button:has-text("Reset")');
    await expect(resetButton).toBeVisible({ timeout: 10_000 });
    await resetButton.click();

    // Reset button disappears
    await expect(resetButton).not.toBeVisible({ timeout: 5_000 });

    // URL should no longer have from/to
    await page.waitForFunction(
      () =>
        !new URL(window.location.href).searchParams.has("from") &&
        !new URL(window.location.href).searchParams.has("to"),
    );
  });

  test("keyboard navigation moves thumbs", async ({ page }) => {
    await page.goto("/map");

    const fromThumb = page.locator('[role="slider"][aria-label="Range start"]');
    await expect(fromThumb).toBeVisible({ timeout: 10_000 });

    // Focus and press right arrow to activate range
    await fromThumb.focus();
    await page.keyboard.press("ArrowRight");

    // Should now have a reset button (range is active)
    const resetButton = page.locator('button:has-text("Reset")');
    await expect(resetButton).toBeVisible({ timeout: 5_000 });
  });
});
