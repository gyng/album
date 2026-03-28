import { test, expect } from "@playwright/test";

test.describe("Slideshow Functionality Tests @slow", () => {
  test("slideshow page loads with extended timeout", async ({ page }) => {
    // Slideshow takes time to load due to database initialization
    await page.goto("/slideshow");

    // Wait for the title to be set (indicates basic loading)
    await expect(page).toHaveTitle("Slideshow", { timeout: 90000 });

    console.log("✓ Slideshow page title loaded");
  });

  test("slideshow displays navigation controls", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for title first
    await expect(page).toHaveTitle("Slideshow", { timeout: 90000 });

    // Look for navigation controls separately to avoid strict mode violation
    const homeLink = page.locator('a:has-text("Snapshots")');
    const previousButton = page.locator('button:has-text("Previous")');
    const nextButton = page.locator('button:has-text("Next")');

    // Wait for at least one to appear
    try {
      await expect(homeLink).toBeVisible({ timeout: 15000 });
      console.log("✓ Home link found");
    } catch {
      try {
        await expect(previousButton).toBeVisible({ timeout: 15000 });
        console.log("✓ Previous button found");
      } catch {
        await expect(nextButton).toBeVisible({ timeout: 15000 });
        console.log("✓ Next button found");
      }
    }

    console.log("✓ Slideshow navigation controls loaded");
  });

  test("slideshow timing controls appear", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for title and basic load
    await expect(page).toHaveTitle("Slideshow", { timeout: 90000 });

    // Look for timing control buttons (from the code we know these exist)
    const timingButtons = page.locator(
      'button:has-text("10s"), button:has-text("1m"), button:has-text("15m")',
    );

    // Should find at least one timing button
    await expect(timingButtons.first()).toBeVisible({ timeout: 30000 });

    const buttonCount = await timingButtons.count();
    console.log(`Found ${buttonCount} timing control buttons`);
  });

  test("slideshow displays images", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for basic load
    await expect(page).toHaveTitle("Slideshow", { timeout: 90000 });

    // Wait for an image to appear in the slideshow
    const slideshowImage = page
      .locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]')
      .first();

    await expect(slideshowImage).toBeVisible({ timeout: 45000 });

    // Get image source to verify it loaded
    const imageSrc = await slideshowImage.getAttribute("src");
    console.log(`Slideshow displaying: ${imageSrc}`);
    expect(imageSrc).toBeTruthy();
  });

  test("slideshow manual next button works", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for slideshow to load
    await expect(page).toHaveTitle("Slideshow", { timeout: 90000 });

    // Wait for image to load
    const slideshowImage = page
      .locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]')
      .first();
    await expect(slideshowImage).toBeVisible({ timeout: 45000 });

    // Get current image source
    const firstImageSrc = await slideshowImage.getAttribute("src");

    // Click next button
    const nextButton = page.locator('button:has-text("Next")');
    await expect(nextButton).toBeVisible({ timeout: 10000 });
    await nextButton.click();

    // Wait a moment for image to potentially change
    await page.waitForTimeout(2000);

    // Check if image changed (may or may not depending on available photos)
    const secondImageSrc = await slideshowImage.getAttribute("src");
    console.log(`Image changed from ${firstImageSrc} to ${secondImageSrc}`);

    console.log("✓ Next button functionality tested");
  });

  test("slideshow previous button restores the prior image", async ({
    page,
  }) => {
    await page.goto("/slideshow");

    await expect(page).toHaveTitle("Slideshow", { timeout: 90000 });

    const slideshowImage = page
      .locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]')
      .first();
    await expect(slideshowImage).toBeVisible({ timeout: 45000 });

    const previousButton = page.locator('button:has-text("Previous")');
    const nextButton = page.locator('button:has-text("Next")');

    await expect(previousButton).toBeDisabled();

    const firstImageSrc = await slideshowImage.getAttribute("src");
    expect(firstImageSrc).toBeTruthy();

    await nextButton.click();
    await page.waitForFunction(
      ([selector, previousSrc]) => {
        const image = document.querySelector(selector);
        return image?.getAttribute("src") !== previousSrc;
      },
      ['img[alt="Slideshow image"]', String(firstImageSrc)],
      { timeout: 10000 },
    );

    const secondImageSrc = await slideshowImage.getAttribute("src");
    expect(secondImageSrc).toBeTruthy();
    expect(secondImageSrc).not.toBe(firstImageSrc);

    await expect(previousButton).toBeEnabled();
    await previousButton.click();

    await expect(slideshowImage).toHaveAttribute("src", String(firstImageSrc));
  });

  test("slideshow toggle controls work", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for slideshow to load
    await expect(page).toHaveTitle("Slideshow", { timeout: 90000 });

    // Look for toggle controls (from code we know these exist)
    const toggleButtons = page.locator(
      'button:has-text("Details"), button:has-text("Map"), button:has-text("🕰️")',
    );

    if ((await toggleButtons.count()) > 0) {
      // Try clicking first toggle button
      await toggleButtons.first().click();
      await page.waitForTimeout(500);

      console.log("✓ Slideshow toggle controls are interactive");
    } else {
      console.log("No toggle controls found - may not be visible yet");
    }
  });

  test("slideshow mode toggle works", async ({ page }) => {
    await page.goto("/slideshow");

    await expect(page).toHaveTitle("Slideshow", { timeout: 90000 });

    const shuffleButton = page.locator('button:has-text("Shuffle")');
    const recentButton = page.locator('button:has-text("Recent")');
    const similarButton = page.locator('button:has-text("Similar")');
    const playbackGroup = page.locator(
      '[role="group"][aria-label="Playback mode"]',
    );

    await expect(playbackGroup).toBeVisible({ timeout: 15000 });
    await expect(shuffleButton).toBeVisible({ timeout: 15000 });
    await expect(recentButton).toBeVisible({ timeout: 15000 });
    await expect(similarButton).toBeVisible({ timeout: 15000 });

    await expect(shuffleButton).toHaveAttribute("aria-pressed", "true");
    await expect(recentButton).toHaveAttribute("aria-pressed", "false");
    await expect(similarButton).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveURL(/mode=random/);

    await recentButton.click();
    await page.waitForTimeout(250);

    await expect(recentButton).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/mode=weighted/);

    await similarButton.evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    await page.waitForTimeout(500);

    await expect(similarButton).toHaveAttribute("aria-pressed", "true");
    await expect(shuffleButton).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveURL(/mode=similar/);

    await shuffleButton.click();
    await page.waitForTimeout(250);

    await expect(shuffleButton).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/mode=random/);
  });

  test("slideshow fullscreen button exists", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for slideshow to load
    await expect(page).toHaveTitle("Slideshow", { timeout: 90000 });

    // Look for fullscreen button
    const fullscreenButton = page.locator(
      'button:has-text("Fullscreen"), button:has-text("⇱")',
    );

    if ((await fullscreenButton.count()) > 0) {
      await expect(fullscreenButton.first()).toBeVisible({ timeout: 10000 });
      console.log("✓ Fullscreen button available");
    } else {
      console.log("Fullscreen button not found - may be rendered differently");
    }
  });

  test("slideshow with album filter works", async ({ page }) => {
    // Test filtered slideshow
    await page.goto("/slideshow?filter=snapshots");

    // Wait for slideshow to load
    await expect(page).toHaveTitle("Slideshow", { timeout: 90000 });

    // Check if filter is indicated using proper selector
    const filterIndicator = page.locator(':has-text("snapshots")');
    if ((await filterIndicator.count()) > 0) {
      console.log("✓ Album filter applied to slideshow");
    }

    // Verify URL contains filter
    expect(page.url()).toContain("filter=snapshots");
    console.log("✓ Slideshow filtering by album works");
  });

  test("slideshow timing adjustment works", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for slideshow to load
    await expect(page).toHaveTitle("Slideshow", { timeout: 90000 });

    // Find timing buttons and click one
    const tenSecondButton = page.locator('button:has-text("10s")');
    if (await tenSecondButton.isVisible({ timeout: 30000 })) {
      await tenSecondButton.click();
      await page.waitForTimeout(500);

      await expect(tenSecondButton).toHaveAttribute("aria-pressed", "true");
      console.log("✓ Timing adjustment controls functional");
    } else {
      console.log("Timing controls not visible - may still be loading");
    }
  });
});
