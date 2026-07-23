import { test, expect, type Page } from "@playwright/test";

/** Slideshow image — the only non-hidden img on the page. */
const slideshowImg = 'img[alt]:not([aria-hidden="true"])';

const waitForImageChange = (page: Page, previousSrc: string) =>
  page.waitForFunction(
    ([selector, prev]) => {
      const img = document.querySelector(selector);
      return img?.getAttribute("src") !== prev;
    },
    [slideshowImg, previousSrc] as const,
  );

const revealControls = async (page: Page) => {
  await page.mouse.move(200, 10);
  await expect(page.getByRole("group", { name: "Playback mode" })).toBeVisible();
};

const settleUi = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

/** Wait for the slideshow to fully load (title + image visible).
 *  The first assertion carries a generous timeout because the slideshow page is
 *  heavy — client-side sql.js WASM init before it can render and set its title —
 *  and when the full Chromium suite runs alongside the Firefox/WebKit smoke jobs
 *  on one runner, 15s was occasionally not enough and exhausted CI retries. The
 *  page load itself is not slow enough to mask a real hang: a genuinely broken
 *  page fails deterministically rather than passing on the next run. */
const waitForSlideshow = async (page: Page) => {
  await expect(page).toHaveTitle("Slideshow | Snapshots", { timeout: 30_000 });
  await expect(page.locator(slideshowImg).first()).toBeVisible();
};

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
  test("desktop controls auto-hide on idle and reveal on mouse-to-top", async ({ page }) => {
    await page.clock.install();
    await page.goto("/slideshow", { waitUntil: "domcontentloaded" });
    await waitForSlideshow(page);

    const container = page.locator("[data-paused]");

    // Advance past CONTROLS_AUTO_HIDE_MS without paying three seconds of wall time.
    await page.clock.runFor(3100);
    await expect(container).toHaveAttribute("data-controls-visible", "false");

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

    // The actual Previous control returns to the first photo; keyboard shortcut
    // dispatch is covered at the utility layer.
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(image).toHaveAttribute("src", String(firstSrc));
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
    await expect(page.locator('button:has-text("Similar")')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await settleUi(page);
    await expect(image).toBeVisible();
    expect(await image.getAttribute("src")).toBe(originalSrc);

    await revealControls(page);
    await page.locator('button:has-text("Recent")').click();
    await expect(page.locator('button:has-text("Recent")')).toHaveAttribute("aria-pressed", "true");
    await settleUi(page);
    await expect(image).toBeVisible();
    expect(await image.getAttribute("src")).toBe(originalSrc);
  });

  test("map display loads its route-scoped vendor stylesheet", async ({ page }) => {
    await page.goto("/slideshow?mode=random&filter=test-simple&map=1&delay=86400", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    await expect(page.locator('link[href="/vendor/maplibre-gl.css"]')).toHaveCount(1);
    await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 15_000 });
    const marker = page.locator("[data-map-pin]").first();
    await expect(marker).toBeVisible();
    expect(
      await marker.evaluate((element) => {
        const colourProbe = document.createElement("span");
        colourProbe.style.color = "var(--c-danger)";
        document.body.append(colourProbe);
        const markerColour = getComputedStyle(element).color;
        const dangerColour = getComputedStyle(colourProbe).color;
        colourProbe.remove();
        return markerColour === dangerColour;
      }),
    ).toBe(true);
  });

  test("4-up remix positions each caption in its own pane", async ({ page }) => {
    // Force the remix layout roll to 3 companions (a 2×2 grid): rollRemix-
    // LayoutCount uses Math.random and returns 3 when r >= 0.95.
    await page.addInitScript(() => {
      Math.random = () => 0.99;
    });
    await page.goto("/slideshow?mode=random&filter=test-simple&details=1&remix=1&delay=86400", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    await revealControls(page);
    await page.locator('button:has-text("Remix now")').click();

    const grid = page.locator('[data-count="4"]').first();
    await expect(grid).toBeVisible({ timeout: 8000 });
    const remixImages = page.locator(
      'div[class*="remixGrid"][data-count="4"]:not([aria-hidden="true"]) img[class*="remixImage"]',
    );
    await expect(remixImages).toHaveCount(4);
    await expect(remixImages.last()).toBeVisible();

    const geo = await page.evaluate(() => {
      const vh = window.innerHeight;
      const cells = Array.from(document.querySelectorAll('div[class*="descriptionCell"]')).slice(
        0,
        4,
      );
      const r = (i: number) => {
        const box = cells[i]!.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      };
      return { vh, d0: r(0), d1: r(1), d2: r(2), d3: r(3) };
    });

    // The bug: all four captions piled up at the bottom. The fix pins the top
    // two captions to the top photo row and the bottom two to the bottom row.
    expect(geo.d0.bottom).toBeLessThan(geo.vh / 2);
    expect(geo.d1.bottom).toBeLessThan(geo.vh / 2);
    expect(geo.d2.top).toBeGreaterThan(geo.vh / 2);
    expect(geo.d3.top).toBeGreaterThan(geo.vh / 2);
  });

  test("auto-advances to the next photo after the configured delay", async ({ page }) => {
    // delay=1 → a 1-second cadence; align-cadence is off (beforeEach) so the
    // advance timer is a plain now+delay.
    await page.clock.install();
    await page.goto("/slideshow?mode=random&filter=test-simple&delay=1", {
      waitUntil: "domcontentloaded",
    });
    await waitForSlideshow(page);

    const image = page.locator(slideshowImg).first();
    const firstSrc = await image.getAttribute("src");

    // The cadence timer should advance with no user interaction.
    await page.clock.runFor(1100);
    await waitForImageChange(page, String(firstSrc));
    expect(await image.getAttribute("src")).not.toBe(firstSrc);
  });

  test("pausing stops the auto-advance", async ({ page }) => {
    await page.clock.install();
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
    await page.clock.runFor(2500);
    expect(await image.getAttribute("src")).toBe(pausedSrc);
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
});

test.describe("Slideshow touch mode", () => {
  test.use({ hasTouch: true });
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
        if (query.includes("hover: none") || query.includes("pointer: coarse")) {
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

  const swipe = async (page: Page, dx: number, dy: number, steps = 6): Promise<void> => {
    const { x, y } = await imageCentre(page);
    await dispatchPointer(page, "down", x, y);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      await dispatchPointer(page, "move", x + dx * t, y + dy * t);
    }
    await dispatchPointer(page, "up", x + dx, y + dy);
  };

  test("horizontal swipe past commit advances to next photo", async ({ page }) => {
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

  test("pull up with controls hidden forces a remix advance", async ({ page }) => {
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

    await settleUi(page);
    expect(await image.getAttribute("src")).toBe(firstSrc);
  });

  test("side affordances stay hidden during touch when controls are visible", async ({ page }) => {
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
});
