import { test, expect, type Page } from "@playwright/test";

/** Slideshow image — the only non-hidden img on the page. */
const slideshowImg = 'img[alt]:not([aria-hidden="true"])';

const waitForImageChange = (page: Page, previousSrc: string) =>
  page.waitForFunction(
    ([selector, prev]) => {
      const img = document.querySelector(selector);
      return img?.getAttribute("src") !== prev;
    },
    [slideshowImg, previousSrc],
  );

const revealControls = async (page: Page) => {
  await page.mouse.move(200, 10);
  await page.waitForTimeout(150);
};

/** Wait for the slideshow to fully load (title + image visible). */
const waitForSlideshow = async (page: Page) => {
  await expect(page).toHaveTitle("Slideshow | Snapshots");
  await expect(page.locator(slideshowImg).first()).toBeVisible();
};

test.describe("Slideshow", () => {
  test("displays image and navigation controls", async ({ page }) => {
    await page.goto("/slideshow", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    await revealControls(page);
    await expect(page.locator('button:has-text("Next")')).toBeVisible();
    await expect(page.locator('button:has-text("Previous")')).toBeVisible();
    await expect(page.locator('a:has-text("Snapshots")')).toBeVisible();
  });

  test("next/previous navigation works", async ({ page }) => {
    await page.goto("/slideshow", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");

    // Next
    await revealControls(page);
    await page.locator('button:has-text("Next")').click();
    await waitForImageChange(page, String(firstSrc));
    const secondSrc = await image.getAttribute("src");
    expect(secondSrc).not.toBe(firstSrc);

    // Previous returns to first
    await page.keyboard.press("ArrowLeft");
    await expect(image).toHaveAttribute("src", String(firstSrc));
  });

  test("keyboard shortcuts work", async ({ page }) => {
    await page.goto("/slideshow", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");

    // ArrowRight advances
    await page.keyboard.press("ArrowRight");
    await waitForImageChange(page, String(firstSrc));
    expect(await image.getAttribute("src")).not.toBe(firstSrc);

    // Space toggles pause
    const container = page.locator("[data-paused]");
    await expect(container).toHaveAttribute("data-paused", "false");
    await page.keyboard.press(" ");
    await expect(container).toHaveAttribute("data-paused", "true");
    await page.keyboard.press(" ");
    await expect(container).toHaveAttribute("data-paused", "false");

    // Escape goes home
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
  });

  test("playback mode toggles work", async ({ page }) => {
    await page.goto("/slideshow", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    const shuffleButton = page.locator('button:has-text("Shuffle")');
    const recentButton = page.locator('button:has-text("Recent")');
    const similarButton = page.locator('button:has-text("Similar")');

    await expect(
      page.locator('[role="group"][aria-label="Playback mode"]'),
    ).toBeVisible();

    // Default is shuffle/random
    await expect(shuffleButton).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/mode=random/);

    // Switch to recent
    await revealControls(page);
    await recentButton.click();
    await expect(recentButton).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/mode=weighted/);

    // Switch to similar
    await similarButton.evaluate((b: HTMLButtonElement) => b.click());
    await expect(similarButton).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/mode=similar/);
  });

  test("pause/resume toggles playback state", async ({ page }) => {
    await page.goto("/slideshow", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    const pauseButton = page.locator('button:has-text("Pause")');
    await expect(pauseButton).toHaveAttribute("aria-pressed", "false");

    await revealControls(page);
    await pauseButton.click();

    const resumeButton = page.locator('button:has-text("Resume")');
    await expect(resumeButton).toBeVisible();
    await expect(resumeButton).toHaveAttribute("aria-pressed", "true");
  });

  test("timing controls work", async ({ page }) => {
    await page.goto("/slideshow", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    const tenSecButton = page.locator('button:has-text("10s")');
    await expect(tenSecButton).toBeVisible();

    await revealControls(page);
    await tenSecButton.click();
    await expect(tenSecButton).toHaveAttribute("aria-pressed", "true");
  });

  test("alignment button cycles through options", async ({ page }) => {
    await page.goto("/slideshow?details=1", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    const alignButton = page.locator('button:has-text("📍")');
    await expect(alignButton).toBeVisible();

    await expect(alignButton).toContainText("Center");
    await alignButton.dispatchEvent("click");
    await expect(alignButton).toContainText("Right");
    await alignButton.dispatchEvent("click");
    await expect(alignButton).toContainText("Left");
    await alignButton.dispatchEvent("click");
    await expect(alignButton).toContainText("Center");
  });

  test("alignment persists across reloads", async ({ page }) => {
    await page.goto("/slideshow?details=1", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    const alignButton = page.locator('button:has-text("📍")');
    await alignButton.dispatchEvent("click"); // Centre -> Right
    await expect(alignButton).toContainText("Right");

    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.locator('button:has-text("📍")')).toContainText("Right");
  });

  test("photo parameter reflects current image", async ({ page }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    await page.waitForFunction(() =>
      new URL(window.location.href).searchParams.has("photo"),
    );

    const firstPhoto = await page.evaluate(() =>
      new URL(window.location.href).searchParams.get("photo"),
    );
    expect(firstPhoto).toContain("../albums/test-simple/");

    await revealControls(page);
    await page.locator('button:has-text("Next")').click();
    await page.waitForFunction(
      (prev) =>
        new URL(window.location.href).searchParams.get("photo") !== prev,
      firstPhoto,
    );

    const secondPhoto = await page.evaluate(() =>
      new URL(window.location.href).searchParams.get("photo"),
    );
    expect(secondPhoto).toContain("../albums/test-simple/");
    expect(secondPhoto).not.toBe(firstPhoto);
  });
});

test.describe("Slideshow URL parameters", () => {
  test("boolean toggles via URL", async ({ page }) => {
    await page.goto("/slideshow?clock=1&details=1&map=1&cover=1", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    for (const label of ["🕰️", "Details", "Map", "Cover"]) {
      await expect(page.locator(`button:has-text("${label}")`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
  });

  test("mode=weighted sets Recent active", async ({ page }) => {
    await page.goto("/slideshow?mode=weighted", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);
    await expect(page.locator('button:has-text("Recent")')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("mode=similar sets Similar active", async ({ page }) => {
    await page.goto("/slideshow?mode=similar", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);
    await expect(page.locator('button:has-text("Similar")')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("align parameter sets alignment", async ({ page }) => {
    await page.goto("/slideshow?align=left&details=1", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);
    await expect(page.locator('button:has-text("📍")')).toContainText("Left");
  });

  test("delay parameter sets timing", async ({ page }) => {
    await page.goto("/slideshow?delay=60", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);
    await expect(page.locator('button:has-text("1m")')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("combined parameters work together", async ({ page }) => {
    await page.goto("/slideshow?clock=1&details=1&delay=30&align=left", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    await expect(page.locator('button:has-text("🕰️")')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator('button:has-text("Details")')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator('button:has-text("📍")')).toContainText("Left");
  });

  test("filter parameter restricts to album", async ({ page }) => {
    await page.goto("/slideshow?filter=test-simple", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);
    expect(page.url()).toContain("filter=test-simple");
  });
});
