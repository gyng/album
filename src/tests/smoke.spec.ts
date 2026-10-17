import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { expectMapLoaded } from "./map-loaded";
import { stubExternalMapAssets } from "./map-network";

test.describe("Smoke Tests", () => {
  let pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await stubExternalMapAssets(page);
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("homepage loads with albums and navigation", async ({ page }) => {
    await gotoHydrated(page, "/");

    await expect(page).toHaveTitle("Snapshots");
    await expect(page.locator("h1")).toContainText("Snapshots");

    // Navigation links
    await expect(page.locator('a[href="/map"]')).toBeVisible();
    await expect(page.getByRole("link", { name: "Explore", exact: true })).toBeVisible();
    await expect(page.locator('a[href="/search"]')).toBeVisible();
    await expect(page.getByRole("link", { name: "Slideshow", exact: true })).toHaveAttribute(
      "href",
      "/slideshow/shell",
    );

    // At least one album
    await expect(page.locator('a[href*="/album/"]').first()).toBeVisible();
  });

  test("album page loads with nav and photos", async ({ page }) => {
    await gotoHydrated(page, "/album/test-simple");

    await expect(page.locator('a:has-text("Albums")')).toBeVisible();
    await expect(page.getByRole("link", { name: "Album map", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Album slideshow", exact: true })).toBeVisible();

    const controls = page.getByRole("group", { name: "Album navigation", exact: true });
    const controlsBox = await controls.boundingBox();
    const searchBox = await page.getByRole("link", { name: "Search", exact: true }).boundingBox();
    expect(controlsBox!.x).toBeGreaterThan(searchBox!.x + searchBox!.width);

    const photos = page.locator("img");
    await expect(photos.first()).toBeVisible();
    expect(await photos.count()).toBeGreaterThan(0);
  });

  // The poster is produced by a build prepass, from a real ffmpeg extraction of
  // the committed fixture clip. Without it the clip is a black rectangle until
  // it plays, and nothing downstream (search, map, timeline) has any pixels for
  // it either — so a missing poster here is the signal that the prepass did not
  // run or did not survive the build.
  test("a local video shows the poster frame extracted for it", async ({ page }) => {
    await gotoHydrated(page, "/album/test-simple#DSCF0159.MOV");

    const video = page.locator("video").first();
    await expect(video).toHaveAttribute(
      "poster",
      /\/data\/albums\/test-simple\/\.resized_images\/DSCF0159\.MOV%40\d+\.avif/,
    );

    const posterUrl = await video.getAttribute("poster");
    const response = await page.request.get(posterUrl!);
    expect(response.status()).toBe(200);
  });

  // On a wide, short screen the clip's 16:9 box was capped by the viewport's
  // height and left at the start of its row, so the picture sat ~90px left of
  // the photographs around it at 1920x1080.
  for (const [width, height] of [
    [1920, 1080],
    [390, 844],
  ] as const) {
    test(`a clip's picture is centred like a photograph at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await gotoHydrated(page, "/album/test-simple#DSCF0159.MOV");
      const video = page.locator("[data-testid=videoblockel] video").first();
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth))
        .toBeGreaterThan(0);

      const { frameCentre, pageCentre } = await video.evaluate((v: HTMLVideoElement) => {
        const box = v.getBoundingClientRect();
        // The picture is contained in the element's box, centred in it.
        const paintedWidth = Math.min(box.width, (box.height * v.videoWidth) / v.videoHeight);
        return {
          frameCentre: box.x + (box.width - paintedWidth) / 2 + paintedWidth / 2,
          // The page's own column: the scrollbar may belong to an inner
          // scroller, so the document's width is not the content's.
          pageCentre: (() => {
            const photo = document.querySelector("main picture img")!.getBoundingClientRect();
            return photo.x + photo.width / 2;
          })(),
        };
      });
      expect(Math.abs(frameCentre - pageCentre)).toBeLessThanOrEqual(2);
    });
  }

  test("map page loads a map that really rendered", async ({ page }) => {
    await gotoHydrated(page, "/map");
    await expect(page).toHaveTitle("Map | Snapshots");
    await expect(page.locator("canvas").first()).toBeVisible();

    // The canvas above exists from the moment the map is constructed, and so do
    // the port's children, so both stay put even when the tile worker is dead.
    // Only the load status distinguishes a rendered map from a blank one — and
    // the smoke suite is the only map coverage Firefox and WebKit get, so it
    // has to ask for the real thing.
    await expectMapLoaded(page);
  });

  test("search page loads", async ({ page, browserName }) => {
    test.skip(browserName === "chromium", "Covered by the full Chromium search suite");
    await gotoHydrated(page, "/search");
    await expect(page.getByRole("heading", { name: /search/i })).toBeVisible();
  });

  test("explore page loads with sections", async ({ page }) => {
    await gotoHydrated(page, "/explore");
    await expect(page).toHaveTitle(/Explore/);
    await expect(page.getByRole("heading", { name: "Explore" })).toBeVisible();

    // Jump nav and at least one data section render
    await expect(page.locator('nav[aria-label="Jump to section"]')).toBeVisible();
  });

  test("timeline page loads", async ({ page, browserName }) => {
    test.skip(browserName === "chromium", "Covered by the full Chromium timeline suite");
    await gotoHydrated(page, "/timeline");
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  });

  test("map album filter shows indicator", async ({ page }) => {
    await gotoHydrated(page, "/map?filter_album=test-simple");
    await expect(page).toHaveTitle("Map | Snapshots");

    // Filter indicator toast appears with album name
    await expect(page.locator("i", { hasText: "test-simple" })).toBeVisible();
    expect(page.url()).toContain("filter_album=test-simple");

    // The toast is page chrome outside <MapView>, so asserting it alone stays
    // green when the map itself renders nothing. Gate on the load status so the
    // album-filtered map path is guarded too.
    await expectMapLoaded(page);
  });

  test("photo deep-link scrolls to photo", async ({ page }) => {
    await gotoHydrated(page, "/album/test-simple#DSCF0506-2.jpg");

    // The photo element with matching ID should be in the viewport
    const photo = page.locator('[id="DSCF0506-2.jpg"]');
    await expect(photo).toBeVisible();
    await expect(photo).toBeInViewport();

    // ...and not jammed against the top edge: the photograph it anchors should
    // have room above it rather than starting at pixel zero.
    const image = photo.locator("xpath=ancestor::*[contains(@class,'block')][1]//img").first();
    const top = await image.evaluate((element) => element.getBoundingClientRect().top);
    expect(top).toBeGreaterThan(8);
  });

  test("slideshow page loads", async ({ page, browserName }) => {
    test.skip(browserName === "chromium", "Covered by the full Chromium slideshow suite");
    await gotoHydrated(page, "/slideshow");
    await expect(page).toHaveTitle("Slideshow | Snapshots");
    // The top slide is an <img> for a photo/poster or a <video> for a clip;
    // both carry data-media-kind. The pool is unfiltered, so it may be either.
    await expect(page.locator('[data-media-kind]:not([aria-hidden="true"])').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("theme picker changes theme", async ({ page }) => {
    // `?theme=` is what the client reads on its first render, and the server
    // rendered the default instead — so the picker arriving at light is the
    // signal that React has taken it over. Choosing before that sets a value
    // hydration then throws away, which is a real race under a busy suite and
    // fails as "picked slate, got dark".
    await gotoHydrated(page, "/?theme=light");

    const html = page.locator("html");
    const themePicker = page.getByRole("combobox", { name: "Theme" });
    await expect(themePicker).toHaveValue("light");
    await themePicker.selectOption("slate");

    // A named theme applies its palette class plus its base colour scheme.
    await expect(html).toHaveClass(/theme-slate/);
    await expect(html).toHaveClass(/(^| )dark( |$)/);
  });
});
