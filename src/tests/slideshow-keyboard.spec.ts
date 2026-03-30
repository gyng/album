import { test, expect } from "@playwright/test";

const waitForImage = (page: import("@playwright/test").Page) =>
  page
    .locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]')
    .first();

const dispatchShortcut = async (
  page: import("@playwright/test").Page,
  key: string,
) => {
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press(key);
};

test.describe("Slideshow Keyboard Navigation", () => {
  test("right arrow key advances to next photo", async ({ page }) => {
    await page.goto("/slideshow");
    await expect(page).toHaveTitle(/Slideshow/);

    const image = waitForImage(page);
    await expect(image).toBeVisible();
    const firstSrc = await image.getAttribute("src");

    await dispatchShortcut(page, "ArrowRight");

    await page.waitForFunction(
      ([selector, previousSrc]) => {
        const img = document.querySelector(selector);
        return img?.getAttribute("src") !== previousSrc;
      },
      ['img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]', String(firstSrc)],
    );

    const secondSrc = await image.getAttribute("src");
    expect(secondSrc).not.toBe(firstSrc);
  });

  test("left arrow key returns to previous photo", async ({ page }) => {
    await page.goto("/slideshow");
    await expect(page).toHaveTitle(/Slideshow/);

    const image = waitForImage(page);
    await expect(image).toBeVisible();
    const firstSrc = await image.getAttribute("src");

    // Advance to second photo
    await dispatchShortcut(page, "ArrowRight");
    await page.waitForFunction(
      ([selector, previousSrc]) => {
        const img = document.querySelector(selector);
        return img?.getAttribute("src") !== previousSrc;
      },
      ['img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]', String(firstSrc)],
    );

    // Go back with left arrow
    await dispatchShortcut(page, "ArrowLeft");
    await expect(image).toHaveAttribute("src", String(firstSrc));
  });

  test("space key toggles pause state", async ({ page }) => {
    await page.goto("/slideshow");
    await expect(page).toHaveTitle(/Slideshow/);

    const image = waitForImage(page);
    await expect(image).toBeVisible();

    const container = page.locator("[data-paused]");
    await expect(container).toHaveAttribute("data-paused", "false");

    await dispatchShortcut(page, " ");
    await expect(container).toHaveAttribute("data-paused", "true");

    await dispatchShortcut(page, " ");
    await expect(container).toHaveAttribute("data-paused", "false");
  });

  test("escape key navigates to home", async ({ page }) => {
    await page.goto("/slideshow");
    await expect(page).toHaveTitle(/Slideshow/);

    await expect(
      page.locator('img[src*=".jpg"], img[src*=".JPG"], img[src*=".avif"]').first(),
    ).toBeVisible();

    await dispatchShortcut(page, "Escape");
    await expect(page).toHaveURL(/\/$/);
  });
});
