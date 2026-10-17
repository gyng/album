import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

/*
 * The clip the E2E build indexes: a committed fixture in `albums/test-simple`,
 * so a section that lists clips at all is guaranteed to list this one. Its
 * poster frame is extracted by the build prepass into the album's own
 * `.resized_images` cache — the same URL space a photo's variants use.
 */
const clipHref = "/album/test-simple#DSCF0159.MOV";
const clipPosterPattern =
  /\/data\/albums\/test-simple\/\.resized_images\/DSCF0159\.MOV%40\d+\.avif/;
const videoBadgePattern = /^Video, 0:1/;
/*
 * The clip's transcoded file, written into the album's own `.resized_videos`
 * cache by the build prepass — the same URL the slideshow specs pin as the
 * playable source of this clip. Spelled out rather than derived, so a preview
 * pointed anywhere else fails here instead of silently loading.
 */
const clipVideoSrc = "/data/albums/test-simple/.resized_videos/DSCF0159.MOV%401920.mp4";

/**
 * The video group's content is in the DOM at every width — the collapse is a
 * stylesheet decision — so a tile assertion only has to scroll the section into
 * view and then wait on the tile itself rather than on a timer.
 */
const scrollToVideoSection = async (page: Page) => {
  const section = page.locator("section#video");
  await expect(section).toBeAttached();
  await section.scrollIntoViewIfNeeded();
  return section;
};

test("explore lists the video section with poster tiles", async ({ page }) => {
  await gotoHydrated(page, "/explore");

  const section = await scrollToVideoSection(page);

  // Located by its heading rather than by the id alone, so a section rendered
  // without a readable title fails here.
  await expect(section.getByRole("heading", { name: "Video" })).toBeVisible();

  const tiles = section.locator('a[href^="/album/"]');
  expect(await tiles.count()).toBeGreaterThanOrEqual(1);
  await expect(tiles.first()).toBeVisible();
});

test("a clip tile links to its anchor, draws the extracted poster and badges its length", async ({
  page,
}) => {
  await gotoHydrated(page, "/explore");

  const section = await scrollToVideoSection(page);
  const tile = section.locator(`a[href="${clipHref}"]`).first();
  await expect(tile).toBeVisible();

  const poster = tile.locator("img").first();
  await expect(poster).toHaveAttribute("src", clipPosterPattern);

  const badge = tile.locator('[aria-label^="Video, 0:1"]').first();
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAccessibleName(videoBadgePattern);

  // The URL on the tile has to be one the server actually serves: a poster
  // advertised in the markup but absent from disk is a blank tile in a real
  // browser.
  const posterUrl = await poster.getAttribute("src");
  const response = await page.request.get(posterUrl!);
  expect(response.status()).toBe(200);
});

/*
 * A clip tile is a still until the pointer asks for more. The preview is
 * mounted on demand and with `preload="none"`, so the initial page carries no
 * media at all: a grid of hundreds of tiles fetches and decodes nothing until
 * one is pointed at.
 */
test("hovering a clip tile plays its clip and leaving pauses it", async ({ page }) => {
  await gotoHydrated(page, "/explore");

  const section = await scrollToVideoSection(page);
  const tile = section.locator(`a[href="${clipHref}"]`).first();
  await expect(tile).toBeVisible();

  // Nothing is mounted — let alone requested — before a pointer arrives.
  await expect(page.locator("video")).toHaveCount(0);

  // The duration badge overlays the poster's own corner, so the pointer is
  // aimed at the image itself: the poster box is the hover target, and the
  // preview must not swallow the event that reaches it.
  const poster = tile.locator("img").first();
  await poster.hover();

  const video = tile.locator("video");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("src", clipVideoSrc);
  await expect(video).toHaveAttribute("preload", "none");
  await expect(video).toHaveJSProperty("muted", true);

  // Proof it is actually playing, not a video element parked at zero.
  await expect
    .poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0);

  // Leaving the poster pauses the same element in place…
  await page.mouse.move(0, 0);
  await expect(video).toHaveJSProperty("paused", true);

  // …and coming back resumes it: a second hover must not mount a second
  // element nor re-request the file.
  await poster.hover();
  await expect(video).toHaveCount(1);
  await expect(video).toHaveJSProperty("paused", false);
});

test("the jump nav reaches the video section", async ({ page }) => {
  await gotoHydrated(page, "/explore");

  const jumpNav = page.locator('nav[aria-label="Jump to section"]');
  const jumpLink = jumpNav.locator('a[href="#video"]');
  await expect(jumpLink).toBeVisible();

  await jumpLink.click();
  await expect(page).toHaveURL(/#video$/);

  // A same-page link lands the reader on the heading, not merely on a URL.
  await expect(
    page.locator("section#video").getByRole("heading", { name: "Video" }),
  ).toBeInViewport();
});

test("the video grid does not overflow a 390px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // The hash keeps the narrow-viewport group open, so the grid itself — not
  // just its collapsed summary — is what gets measured.
  await gotoHydrated(page, "/explore#video");

  const section = page.locator("section#video");
  await expect(section.locator('[aria-label^="Video, 0:1"]').first()).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
