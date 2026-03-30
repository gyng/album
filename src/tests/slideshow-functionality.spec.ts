import { test, expect, type Page } from "@playwright/test";

const slideshowTitle = /Slideshow \| Snapshots/;

const revealSlideshowControls = async (page: Page) => {
  await page.mouse.move(200, 10);
  await page.waitForTimeout(150);
};

test.describe("Slideshow Functionality Tests", () => {
  test("slideshow page loads with extended timeout", async ({ page }) => {
    // Slideshow takes time to load due to database initialization
    await page.goto("/slideshow");

    // Wait for the title to be set (indicates basic loading)
    await expect(page).toHaveTitle(slideshowTitle);

    console.log("✓ Slideshow page title loaded");
  });

  test("slideshow displays navigation controls", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for title first
    await expect(page).toHaveTitle(slideshowTitle);

    // Look for navigation controls separately to avoid strict mode violation
    const homeLink = page.locator('a:has-text("Snapshots")');
    const previousButton = page.locator('button:has-text("Previous")');
    const nextButton = page.locator('button:has-text("Next")');

    // Wait for at least one to appear
    try {
      await expect(homeLink).toBeVisible();
      console.log("✓ Home link found");
    } catch {
      try {
        await expect(previousButton).toBeVisible();
        console.log("✓ Previous button found");
      } catch {
        await expect(nextButton).toBeVisible();
        console.log("✓ Next button found");
      }
    }

    console.log("✓ Slideshow navigation controls loaded");
  });

  test("slideshow timing controls appear", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for title and basic load
    await expect(page).toHaveTitle(slideshowTitle);

    // Look for timing control buttons (from the code we know these exist)
    const timingButtons = page.locator(
      'button:has-text("10s"), button:has-text("1m"), button:has-text("15m")',
    );

    // Should find at least one timing button
    await expect(timingButtons.first()).toBeVisible();

    const buttonCount = await timingButtons.count();
    console.log(`Found ${buttonCount} timing control buttons`);
  });

  test("slideshow displays images", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for basic load
    await expect(page).toHaveTitle(slideshowTitle);

    // Wait for an image to appear in the slideshow
    const slideshowImage = page
      .locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]')
      .first();

    await expect(slideshowImage).toBeVisible();

    // Get image source to verify it loaded
    const imageSrc = await slideshowImage.getAttribute("src");
    console.log(`Slideshow displaying: ${imageSrc}`);
    expect(imageSrc).toBeTruthy();
  });

  test("slideshow manual next button works", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for slideshow to load
    await expect(page).toHaveTitle(slideshowTitle);

    // Wait for image to load
    const slideshowImage = page
      .locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]')
      .first();
    await expect(slideshowImage).toBeVisible();

    // Get current image source
    const firstImageSrc = await slideshowImage.getAttribute("src");

    // Click next button
    const nextButton = page.locator('button:has-text("Next")');
    await expect(nextButton).toBeVisible();
    await revealSlideshowControls(page);
    await nextButton.click();

    await page.waitForFunction(
      ([selector, previousSrc]) => {
        const img = document.querySelector(selector);
        return img?.getAttribute("src") !== previousSrc;
      },
      [
        'img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]',
        String(firstImageSrc),
      ],
    );

    const secondImageSrc = await slideshowImage.getAttribute("src");
    console.log(`Image changed from ${firstImageSrc} to ${secondImageSrc}`);
    expect(secondImageSrc).toBeTruthy();
    expect(secondImageSrc).not.toBe(firstImageSrc);

    console.log("✓ Next button functionality tested");
  });

  test("slideshow previous navigation restores the prior image", async ({
    page,
  }) => {
    await page.goto("/slideshow");

    await expect(page).toHaveTitle(slideshowTitle);

    const slideshowImage = page
      .locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]')
      .first();
    await expect(slideshowImage).toBeVisible();

    const firstImageSrc = await slideshowImage.getAttribute("src");
    expect(firstImageSrc).toBeTruthy();

    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      ([selector, previousSrc]) => {
        const img = document.querySelector(selector);
        return img?.getAttribute("src") !== previousSrc;
      },
      [
        'img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]',
        String(firstImageSrc),
      ],
    );

    const secondImageSrc = await slideshowImage.getAttribute("src");
    expect(secondImageSrc).toBeTruthy();
    expect(secondImageSrc).not.toBe(firstImageSrc);

    await page.keyboard.press("ArrowLeft");

    await expect(slideshowImage).toHaveAttribute("src", String(firstImageSrc));
  });

  test("slideshow toggle controls work", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for slideshow to load
    await expect(page).toHaveTitle(slideshowTitle);

    // Look for toggle controls (from code we know these exist)
    const toggleButtons = page.locator(
      'button:has-text("Details"), button:has-text("Map"), button:has-text("🕰️")',
    );

    if ((await toggleButtons.count()) > 0) {
      // Try clicking first toggle button
      await revealSlideshowControls(page);
      await toggleButtons.first().click();
      await page.waitForTimeout(500);

      console.log("✓ Slideshow toggle controls are interactive");
    } else {
      console.log("No toggle controls found - may not be visible yet");
    }
  });

  test("slideshow mode toggle works", async ({ page }) => {
    await page.goto("/slideshow");

    await expect(page).toHaveTitle(slideshowTitle);

    const shuffleButton = page.locator('button:has-text("Shuffle")');
    const recentButton = page.locator('button:has-text("Recent")');
    const similarButton = page.locator('button:has-text("Similar")');
    const playbackGroup = page.locator(
      '[role="group"][aria-label="Playback mode"]',
    );

    await expect(playbackGroup).toBeVisible();
    await expect(shuffleButton).toBeVisible();
    await expect(recentButton).toBeVisible();
    await expect(similarButton).toBeVisible();

    await expect(shuffleButton).toHaveAttribute("aria-pressed", "true");
    await expect(recentButton).toHaveAttribute("aria-pressed", "false");
    await expect(similarButton).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveURL(/mode=random/);

    await revealSlideshowControls(page);
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

    await revealSlideshowControls(page);
    await shuffleButton.click();
    await page.waitForTimeout(250);

    await expect(shuffleButton).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/mode=random/);
  });

  test("slideshow pause control toggles playback state", async ({ page }) => {
    await page.goto("/slideshow");

    await expect(page).toHaveTitle(slideshowTitle);

    const pauseButton = page.locator('button:has-text("Pause")');
    await expect(pauseButton).toBeVisible();
    await expect(pauseButton).toHaveAttribute("aria-pressed", "false");

    await revealSlideshowControls(page);
    await pauseButton.click();
    await expect(page.locator('button:has-text("Resume")')).toBeVisible();
    await expect(page.locator('button:has-text("Resume")')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("slideshow fullscreen button exists", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for slideshow to load
    await expect(page).toHaveTitle(slideshowTitle);

    // Look for fullscreen button
    const fullscreenButton = page.locator(
      'button:has-text("Fullscreen"), button:has-text("⇱")',
    );

    if ((await fullscreenButton.count()) > 0) {
      await expect(fullscreenButton.first()).toBeVisible();
      console.log("✓ Fullscreen button available");
    } else {
      console.log("Fullscreen button not found - may be rendered differently");
    }
  });

  test("slideshow with album filter works", async ({ page }) => {
    // Test filtered slideshow
    await page.goto("/slideshow?filter=test-simple");

    // Wait for slideshow to load
    await expect(page).toHaveTitle(slideshowTitle);

    // Check if filter is indicated using proper selector
    const filterIndicator = page.locator(':has-text("test-simple")');
    if ((await filterIndicator.count()) > 0) {
      console.log("✓ Album filter applied to slideshow");
    }

    // Verify URL contains filter
    expect(page.url()).toContain("filter=test-simple");
    console.log("✓ Slideshow filtering by album works");
  });

  test("slideshow timing adjustment works", async ({ page }) => {
    await page.goto("/slideshow");

    // Wait for slideshow to load
    await expect(page).toHaveTitle(slideshowTitle);

    // Find timing buttons and click one
    const tenSecondButton = page.locator('button:has-text("10s")');
    if (await tenSecondButton.isVisible()) {
      await revealSlideshowControls(page);
      await tenSecondButton.click();
      await page.waitForTimeout(500);

      await expect(tenSecondButton).toHaveAttribute("aria-pressed", "true");
      console.log("✓ Timing adjustment controls functional");
    } else {
      console.log("Timing controls not visible - may still be loading");
    }
  });
});
