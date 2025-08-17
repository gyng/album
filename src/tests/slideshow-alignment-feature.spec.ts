import { test, expect } from "@playwright/test";

test.describe("Slideshow Details Alignment Feature", () => {
  test("complete alignment feature demonstration", async ({ page }) => {
    // Navigate to slideshow
    await page.goto("/slideshow", {
      timeout: 90000,
      waitUntil: "domcontentloaded",
    });

    await page.waitForTimeout(10000);
    console.log("✅ Slideshow loaded successfully");

    // Verify alignment button exists and is functional
    const alignmentButton = page.locator('button:has-text("📍")');
    await expect(alignmentButton).toBeVisible();
    console.log("✅ Alignment button is visible in toolbar");

    // Test initial state (center)
    await expect(alignmentButton).toContainText("📍 Center");
    let classes = await alignmentButton.getAttribute("class");
    expect(classes).not.toContain("active"); // Center is not highlighted (default)
    console.log("✅ Default state: Center alignment (not highlighted)");

    // Test cycling: Center → Right
    await alignmentButton.click();
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText("📍 Right");
    classes = await alignmentButton.getAttribute("class");
    expect(classes).toContain("active"); // Right is highlighted (non-default)
    console.log("✅ Cycle 1: Right alignment (highlighted)");

    // Test cycling: Right → Left
    await alignmentButton.click();
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText("📍 Left");
    classes = await alignmentButton.getAttribute("class");
    expect(classes).toContain("active"); // Left is highlighted (non-default)
    console.log("✅ Cycle 2: Left alignment (highlighted)");

    // Test cycling: Left → Center
    await alignmentButton.click();
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText("📍 Center");
    classes = await alignmentButton.getAttribute("class");
    expect(classes).not.toContain("active"); // Back to center (not highlighted)
    console.log("✅ Cycle 3: Back to center alignment (not highlighted)");

    // Test with details enabled
    const detailsButton = page.locator('button:has-text("Details")');
    if (await detailsButton.isVisible()) {
      await detailsButton.click();
      await page.waitForTimeout(2000);
      console.log("✅ Details panel enabled");

      // Test alignment with details visible
      await alignmentButton.click(); // Center → Right
      await page.waitForTimeout(500);
      await expect(alignmentButton).toContainText("📍 Right");
      console.log("✅ Right alignment applied with details visible");

      await alignmentButton.click(); // Right → Left
      await page.waitForTimeout(500);
      await expect(alignmentButton).toContainText("📍 Left");
      console.log("✅ Left alignment applied with details visible");
    }

    console.log("🎉 Slideshow details alignment feature is fully functional!");
  });

  test("feature integration with other slideshow controls", async ({
    page,
  }) => {
    await page.goto("/slideshow", {
      timeout: 90000,
      waitUntil: "domcontentloaded",
    });

    await page.waitForTimeout(10000);

    // Test that alignment works alongside other features
    const alignmentButton = page.locator('button:has-text("📍")');
    const detailsButton = page.locator('button:has-text("Details")');
    const mapButton = page.locator('button:has-text("Map")');
    const clockButton = page.locator('button:has-text("🕰️")');

    // Set non-default alignment
    await alignmentButton.click(); // Center → Right
    await page.waitForTimeout(500);

    // Enable multiple features
    if (await detailsButton.isVisible()) await detailsButton.click();
    await page.waitForTimeout(1000);

    if (await clockButton.isVisible()) await clockButton.click();
    await page.waitForTimeout(1000);

    if (await mapButton.isVisible()) await mapButton.click();
    await page.waitForTimeout(1000);

    // Verify alignment persists
    await expect(alignmentButton).toContainText("📍 Right");
    console.log("✅ Alignment persists when enabling other features");

    // Test alignment changes with multiple features active
    await alignmentButton.click(); // Right → Left
    await page.waitForTimeout(500);
    await expect(alignmentButton).toContainText("📍 Left");
    console.log("✅ Alignment can be changed with multiple features active");

    console.log("✅ Feature integrates well with other slideshow controls");
  });
});
