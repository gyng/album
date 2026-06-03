import { test, expect, type Page } from "@playwright/test";
import { existsSync, statSync } from "fs";
import { join } from "path";

const searchDbPath = join(__dirname, "..", "public", "search.sqlite");
const hasSearchDb =
  existsSync(searchDbPath) && statSync(searchDbPath).size > 0;

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

/** Wait for the slideshow to fully load (title + image visible).
 *  Uses a longer timeout for the first assertion since the slideshow
 *  page is heavy (WASM sql.js init) and may load slowly under contention. */
const waitForSlideshow = async (page: Page) => {
  await expect(page).toHaveTitle("Slideshow | Snapshots", { timeout: 15_000 });
  await expect(page.locator(slideshowImg).first()).toBeVisible();
};

test.describe.configure({ mode: "serial" });

// Disable wall-clock cadence alignment in every slideshow test so the auto-
// advance timer can't fire mid-test when a quarter-hour boundary happens to
// land within the test's runtime. Production defaults to alignment on; tests
// need a fresh "now + delay" timer per advance for deterministic behaviour.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("slideshow-align-cadence", "false");
    } catch {
      // localStorage may be unavailable in some sandboxed contexts; ignore.
    }
  });
});

test.describe("Slideshow", () => {
  test.skip(!hasSearchDb, "Requires search.sqlite with data");

  test("displays image and navigation controls", async ({ page }) => {
    await page.goto("/slideshow", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    await revealControls(page);
    await expect(page.locator('button:has-text("Next")')).toBeVisible();
    await expect(page.locator('button:has-text("Previous")')).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Snapshots Slideshow" }),
    ).toBeVisible();
  });

  test("desktop controls auto-hide on idle and reveal on mouse-to-top", async ({
    page,
  }) => {
    await page.goto("/slideshow", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    const container = page.locator("[data-paused]");

    // Controls start visible; with no pointer interaction the desktop
    // auto-hide deadline (CONTROLS_AUTO_HIDE_MS = 3s) runs to completion.
    // (It may already have elapsed during a slow WASM load — either way the
    // end state is hidden.)
    await expect(container).toHaveAttribute("data-controls-visible", "false", {
      timeout: 8000,
    });

    // Moving the cursor to the top edge reveals them again.
    await revealControls(page);
    await expect(container).toHaveAttribute("data-controls-visible", "true");
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

  test("switching playback mode keeps a photo on screen", async ({ page }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    await expect(image).toHaveAttribute("src", /\.avif$/);
    const originalSrc = await image.getAttribute("src");

    // Switching mode must carry the CURRENT photo into the new mode's history,
    // not blank the slide or swap to a fresh random photo. Assert the SAME src
    // persists, and give any (regressed) pool refetch time to settle first.
    await revealControls(page);
    await page.locator('button:has-text("Similar")').click();
    await page.waitForTimeout(400);
    await expect(image).toBeVisible();
    expect(await image.getAttribute("src")).toBe(originalSrc);

    await revealControls(page);
    await page.locator('button:has-text("Recent")').click();
    await page.waitForTimeout(400);
    await expect(image).toBeVisible();
    expect(await image.getAttribute("src")).toBe(originalSrc);
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

    // Default is recent/weighted
    await expect(recentButton).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/mode=weighted/);

    // Switch to shuffle
    await revealControls(page);
    await shuffleButton.click();
    await expect(shuffleButton).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/mode=random/);

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

  test("auto-advances to the next photo after the configured delay", async ({
    page,
  }) => {
    // delay=1 → a 1-second cadence; align-cadence is off (beforeEach) so the
    // advance timer is a plain now+delay.
    await page.goto("/slideshow?mode=random&filter=test-simple&delay=1", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");

    // The cadence timer should advance with no user interaction.
    await waitForImageChange(page, String(firstSrc));
    expect(await image.getAttribute("src")).not.toBe(firstSrc);
  });

  test("pausing stops the auto-advance", async ({ page }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple&delay=1", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();

    await revealControls(page);
    await page.locator('button:has-text("Pause")').click();
    // Confirm pause took effect (timer torn down) before sampling the src.
    await expect(page.locator('button:has-text("Resume")')).toBeVisible();

    const pausedSrc = await image.getAttribute("src");
    // Well past the 1s cadence: a running timer would have advanced by now.
    await page.waitForTimeout(2500);
    expect(await image.getAttribute("src")).toBe(pausedSrc);
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

  test("current image does not get written into the URL", async ({ page }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    await expect(page).toHaveURL(/mode=random/);
    expect(new URL(page.url()).searchParams.has("photo")).toBe(false);
    expect(new URL(page.url()).searchParams.has("seed")).toBe(false);

    await revealControls(page);
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(150);

    const url = new URL(page.url());
    expect(url.searchParams.get("mode")).toBe("random");
    expect(url.searchParams.get("filter")).toBe("test-simple");
    expect(url.searchParams.has("photo")).toBe(false);
    expect(url.searchParams.has("seed")).toBe(false);
  });
});

test.describe("Slideshow touch mode", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!hasSearchDb, "Requires search.sqlite with data");
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Synthetic pointer-event dispatch is reliable only on Chromium",
  );

  // Force coarse-pointer detection and stub pointer capture so synthetic
  // PointerEvents can drive the slideshow gesture handlers without throwing.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (query: string): MediaQueryList => {
        if (
          query.includes("hover: none") ||
          query.includes("pointer: coarse")
        ) {
          return {
            matches: true,
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
          } as MediaQueryList;
        }
        return orig(query);
      };
      Element.prototype.setPointerCapture = function () {};
      Element.prototype.releasePointerCapture = function () {};
      Element.prototype.hasPointerCapture = function () {
        return false;
      };
    });
  });

  const dispatchPointer = async (
    page: Page,
    type: "down" | "move" | "up",
    x: number,
    y: number,
  ) => {
    await page.evaluate(
      ({ type, x, y, selector }) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) throw new Error(`element ${selector} not found`);
        const ev = new PointerEvent(`pointer${type}`, {
          pointerId: 1,
          pointerType: "touch",
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
          isPrimary: true,
          button: 0,
          buttons: type === "up" ? 0 : 1,
        });
        el.dispatchEvent(ev);
      },
      { type, x, y, selector: slideshowImg },
    );
  };

  const imageCentre = async (page: Page) => {
    const box = await page.locator(slideshowImg).first().boundingBox();
    if (!box) throw new Error("Slideshow image has no bounding box");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  };

  const swipe = async (
    page: Page,
    dx: number,
    dy: number,
    steps = 6,
  ): Promise<void> => {
    const { x, y } = await imageCentre(page);
    await dispatchPointer(page, "down", x, y);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      await dispatchPointer(page, "move", x + dx * t, y + dy * t);
    }
    await dispatchPointer(page, "up", x + dx, y + dy);
  };

  test("horizontal swipe past commit advances to next photo", async ({
    page,
  }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");

    // Swipe left past the 48px commit threshold → next photo.
    await swipe(page, -90, 0);
    await waitForImageChange(page, String(firstSrc));
    expect(await image.getAttribute("src")).not.toBe(firstSrc);
  });

  test("horizontal swipe below commit threshold does not change photo", async ({
    page,
  }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");

    // 20px is below the 48px commit threshold.
    await swipe(page, -20, 0);
    await page.waitForTimeout(200);
    expect(await image.getAttribute("src")).toBe(firstSrc);
  });

  test("right swipe goes to previous photo after advancing", async ({
    page,
  }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");

    // Build up history with a keyboard advance so a previous photo exists.
    await page.keyboard.press("ArrowRight");
    await waitForImageChange(page, String(firstSrc));
    const secondSrc = await image.getAttribute("src");
    expect(secondSrc).not.toBe(firstSrc);

    // Swipe right past commit → previous.
    await swipe(page, 90, 0);
    await expect(image).toHaveAttribute("src", String(firstSrc));
  });

  test("pull up past commit hides visible controls", async ({ page }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const container = page.locator("[data-paused]");
    await expect(container).toHaveAttribute("data-controls-visible", "true");

    await swipe(page, 0, -100, 10);
    await expect(container).toHaveAttribute("data-controls-visible", "false");
  });

  test("pull down past commit shows hidden controls", async ({ page }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const container = page.locator("[data-paused]");

    // Hide controls first via a pull-up gesture.
    await swipe(page, 0, -100, 10);
    await expect(container).toHaveAttribute("data-controls-visible", "false");

    // Then pull down → controls return.
    await swipe(page, 0, 100, 10);
    await expect(container).toHaveAttribute("data-controls-visible", "true");
  });

  test("pull up with controls hidden forces a remix advance", async ({
    page,
  }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const container = page.locator("[data-paused]");
    const image = page.locator(slideshowImg).first();

    // First pull-up hides the (initially visible) controls.
    await swipe(page, 0, -100, 10);
    await expect(container).toHaveAttribute("data-controls-visible", "false");

    // Second pull-up with controls hidden forces the next advance to be a
    // remix (mirrors the "Remix now" button), which moves to a new seed photo.
    const beforeSrc = await image.getAttribute("src");
    await swipe(page, 0, -100, 10);
    await waitForImageChange(page, String(beforeSrc));
    expect(await image.getAttribute("src")).not.toBe(beforeSrc);
  });

  test("data-touch-active toggles around the gesture lifecycle", async ({
    page,
  }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const container = page.locator("[data-paused]");
    await expect(container).toHaveAttribute("data-touch-active", "false");

    const { x, y } = await imageCentre(page);
    await dispatchPointer(page, "down", x, y);
    await expect(container).toHaveAttribute("data-touch-active", "true");

    await dispatchPointer(page, "up", x, y);
    await expect(container).toHaveAttribute("data-touch-active", "false");
  });

  test("data-touch-armed flips when the gesture crosses the commit threshold", async ({
    page,
  }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const affordances = page.locator("[data-touch-armed][data-touch-hint]");
    await expect(affordances).toHaveAttribute("data-touch-armed", "false");

    const { x, y } = await imageCentre(page);
    await dispatchPointer(page, "down", x, y);
    // Move below commit (hint zone only).
    await dispatchPointer(page, "move", x - 30, y);
    await expect(affordances).toHaveAttribute("data-touch-armed", "false");
    // Cross the 48px commit threshold.
    await dispatchPointer(page, "move", x - 80, y);
    await expect(affordances).toHaveAttribute("data-touch-armed", "true");
    // Release without firing the action — drag back inside the hint zone.
    await dispatchPointer(page, "move", x - 10, y);
    await dispatchPointer(page, "up", x - 10, y);
    await expect(affordances).toHaveAttribute("data-touch-armed", "false");
  });

  test("reversing past the start cancels the armed visual", async ({
    page,
  }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const affordances = page.locator("[data-touch-armed][data-touch-hint]");
    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");

    const { x, y } = await imageCentre(page);
    await dispatchPointer(page, "down", x, y);
    // Commit "next" (left swipe) past the threshold.
    await dispatchPointer(page, "move", x - 80, y);
    await expect(affordances).toHaveAttribute("data-touch-armed", "true");
    // Reverse past the start to +30 — still inside the hint zone but the
    // direction is now "previous", contradicting the committed "next" hint.
    // The visual must drop back to idle so it doesn't promise an action that
    // won't fire.
    await dispatchPointer(page, "move", x + 30, y);
    await expect(affordances).toHaveAttribute("data-touch-armed", "false");
    await expect(affordances).toHaveAttribute("data-touch-hint", "idle");
    await dispatchPointer(page, "up", x + 30, y);
    // No photo change should have occurred.
    await page.waitForTimeout(150);
    expect(await image.getAttribute("src")).toBe(firstSrc);
  });

  // Real iPad Safari fires a click event after every touch pointerup. The
  // chromium PointerEvent dispatch in our tests does NOT, so we have to
  // synthesise it explicitly to validate the suppression logic.
  const dispatchClick = async (page: Page, x: number, y: number) => {
    await page.evaluate(
      ({ x, y, selector }) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) throw new Error(`element ${selector} not found`);
        el.dispatchEvent(
          new MouseEvent("click", {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
      },
      { x, y, selector: slideshowImg },
    );
  };

  test("synthetic click after a mid-distance touch gesture does not advance the photo", async ({
    page,
  }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");

    const { x, y } = await imageCentre(page);
    await dispatchPointer(page, "down", x, y);
    // 30px: above the 12px tap threshold, below the 48px swipe commit
    // threshold — the cancelled-gesture fall-through.
    await dispatchPointer(page, "move", x - 30, y);
    await dispatchPointer(page, "up", x - 30, y);
    await dispatchClick(page, x - 30, y);

    await page.waitForTimeout(150);
    expect(await image.getAttribute("src")).toBe(firstSrc);
  });

  test("synthetic click after a vertical mid-distance gesture does not advance the photo", async ({
    page,
  }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");

    const { x, y } = await imageCentre(page);
    await dispatchPointer(page, "down", x, y);
    // 30px vertical: above the 12px tap zone, below the 48px swipe threshold
    // AND the 72px pull threshold — falls through all action branches.
    await dispatchPointer(page, "move", x, y - 30);
    await dispatchPointer(page, "up", x, y - 30);
    await dispatchClick(page, x, y - 30);

    await page.waitForTimeout(150);
    expect(await image.getAttribute("src")).toBe(firstSrc);
  });

  test("synthetic click after a reversed-cancel does not advance the photo", async ({
    page,
  }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");

    const { x, y } = await imageCentre(page);
    await dispatchPointer(page, "down", x, y);
    await dispatchPointer(page, "move", x - 80, y); // commits "next"
    await dispatchPointer(page, "move", x + 30, y); // reverses past start
    await dispatchPointer(page, "up", x + 30, y);
    await dispatchClick(page, x + 30, y);

    await page.waitForTimeout(150);
    expect(await image.getAttribute("src")).toBe(firstSrc);
  });

  test("side affordances stay hidden during touch when controls are visible", async ({
    page,
  }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const container = page.locator("[data-paused]");
    await expect(container).toHaveAttribute("data-controls-visible", "true");

    const { x, y } = await imageCentre(page);
    await dispatchPointer(page, "down", x, y);

    // The idle-peek opacity (0.32) outranks the controls-visible hide rule on
    // raw specificity grounds. Without the data-controls-visible="false"
    // qualifier on the peek selector, the side chevrons flash whenever the
    // user touches the image with the toolbar open. Verify they stay hidden.
    const opacities = await page.evaluate(() => {
      const pick = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? Number(getComputedStyle(el).opacity) : null;
      };
      return {
        left: pick('[class*="touchSideAffordanceLeft"]'),
        right: pick('[class*="touchSideAffordanceRight"]'),
      };
    });
    // Guard against a silent pass if CSS Modules ever changes its hash format
    // and the substring selector misses — `null < 0.05` would otherwise be
    // truthy because null coerces to 0.
    expect(opacities.left).not.toBeNull();
    expect(opacities.right).not.toBeNull();
    expect(opacities.left).toBeLessThan(0.05);
    expect(opacities.right).toBeLessThan(0.05);

    await dispatchPointer(page, "up", x, y);
  });

  test("horizontal commit ignores vertical drift", async ({ page }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");
    const container = page.locator("[data-paused]");
    const initialControlsVisible =
      await container.getAttribute("data-controls-visible");

    const { x, y } = await imageCentre(page);
    await dispatchPointer(page, "down", x, y);
    // Cross horizontal commit first.
    await dispatchPointer(page, "move", x - 60, y);
    // Then drift downward by a lot — must not trigger the controls pull.
    await dispatchPointer(page, "move", x - 70, y + 120);
    await dispatchPointer(page, "up", x - 70, y + 120);

    // Image should have advanced (horizontal action committed).
    await waitForImageChange(page, String(firstSrc));
    // Controls visibility should not have flipped from the drift.
    await expect(container).toHaveAttribute(
      "data-controls-visible",
      String(initialControlsVisible),
    );
  });
});

test.describe("Slideshow URL parameters", () => {
  test.skip(!hasSearchDb, "Requires search.sqlite with data");

  test("URL parameters set correct initial state", async ({ page }) => {
    await page.goto(
      "/slideshow?clock=1&details=1&map=1&cover=1&mode=weighted&delay=60&align=left&filter=test-simple",
      { waitUntil: "domcontentloaded" },
    );
    await waitForSlideshow(page);

    // Boolean toggles
    for (const label of ["🕰️", "Details", "Map", "Fill screen"]) {
      await expect(page.locator(`button:has-text("${label}")`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }

    // Mode
    await expect(page.locator('button:has-text("Recent")')).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Delay
    await expect(page.locator('button:has-text("1m")')).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Alignment
    await expect(page.locator('button:has-text("📍")')).toContainText("Left");

    // Filter
    expect(page.url()).toContain("filter=test-simple");
  });
});
