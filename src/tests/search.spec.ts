import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

const expectedJapanResultHrefs = [
  // The album's committed clip is tagged japan too: it is indexed through the
  // poster frame the prepass extracts from it.
  "/album/test-simple#DSCF0159.MOV",
  "/album/test-simple#DSCF0506-2.jpg",
  "/album/test-simple#DSCF0593.jpg",
];

const expectJapanResults = async (page: Page) => {
  const resultPictures = page.getByTestId("result-picture");
  await expect(resultPictures).toHaveCount(3, { timeout: 15_000 });
  const resultHrefs = await resultPictures.evaluateAll((pictures) =>
    pictures
      .map((picture) => picture.closest("a")?.getAttribute("href"))
      .filter((href): href is string => Boolean(href))
      .sort(),
  );
  expect(resultHrefs).toEqual(expectedJapanResultHrefs);
};

/*
 * The clip the `japan` results carry, and the transcoded file the build
 * prepass wrote for it — the same URL the slideshow specs pin. Both are
 * spelled out so a preview that misses its element, or points somewhere else,
 * fails here.
 */
const clipResultHref = "/album/test-simple#DSCF0159.MOV";
const clipPreviewSrc = "/data/albums/test-simple/.resized_videos/DSCF0159.MOV%401920.mp4";
const photoResultHref = "/album/test-simple#DSCF0506-2.jpg";

test.describe("Search", () => {
  let pageErrors: string[] = [];

  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("search page loads with explore section", async ({ page }) => {
    await gotoHydrated(page, "/search");

    await expect(page.getByRole("heading", { name: /search/i })).toBeVisible();

    // Browse mode explore section renders
    await expect(page.getByLabel("Explore browse mode")).toBeVisible();
  });

  test("hybrid shows keyword matches while the semantic engine is still booting", async ({
    page,
  }) => {
    // A silent worker represents a cold model download without transferring
    // the real 155 MB model into a deterministic browser test.
    await page.addInitScript(() => {
      const OriginalWorker = window.Worker;
      window.Worker = class extends OriginalWorker {
        override postMessage(message: unknown, transfer: Transferable[]): void;
        override postMessage(message: unknown, options?: StructuredSerializeOptions): void;
        override postMessage(
          message: unknown,
          options: Transferable[] | StructuredSerializeOptions = {},
        ) {
          const request = message as { type?: string };
          if (request.type === "warmup" || request.type === "encode") return;
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options);
        }
      };
    });
    await gotoHydrated(page, "/search?q=japan&mode=hybrid");
    await expectJapanResults(page);
    await expect(page.getByRole("textbox", { name: "Search photos" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  test("keyword search returns only matching results", async ({ page }) => {
    await gotoHydrated(page, "/search");

    // Use keyword mode to avoid WebGPU dependency
    await page.getByLabel("Search mode", { exact: true }).selectOption("keyword");

    const input = page.getByRole("textbox", { name: "Search photos" });
    await input.fill("japan");
    await expect(input).toHaveAttribute("aria-busy", "true");
    await expect(page.locator('ul[aria-busy="true"] > li[role="status"]')).toHaveText("Searching…");
    await expect(page).toHaveURL(/q=japan/);

    await expectJapanResults(page);
    await expect(input).toHaveAttribute("aria-busy", "false");
  });

  // The whole chain in one assertion: a poster frame extracted at build time, a
  // media_kind the database carries, the capability probe that reads it, and the
  // badge that tells a viewer this result plays.
  test("a video result is marked as playable with its length", async ({ page }) => {
    await gotoHydrated(page, "/search");
    // Keyword mode, like the other searches here: semantic would block on a
    // 147MB model download that has nothing to do with what this asserts.
    await page.getByLabel("Search mode", { exact: true }).selectOption("keyword");
    await page.getByRole("textbox", { name: "Search photos" }).fill("japan");

    const badge = page.getByLabel("Video, 0:13");
    await expect(badge).toBeVisible({ timeout: 15_000 });

    const videoResult = page.locator('a[href="/album/test-simple#DSCF0159.MOV"]').first();
    await expect(videoResult).toBeVisible();
    const thumbnail = videoResult.locator("img").first();
    await expect(thumbnail).toHaveAttribute("src", /DSCF0159\.MOV%40\d+\.avif/);
  });

  /*
   * The same clip, reached through search rather than the explore index: its
   * result is a still until the pointer asks for the preview, exactly as the
   * explore tile is. The pointer is aimed at the thumbnail itself — the tile's
   * action buttons sit over its own corner — and `page.locator("video")`
   * covers the whole grid, so a preview mounted anywhere would fail here.
   */
  test("a video result plays its clip on hover and pauses when the pointer leaves", async ({
    page,
  }) => {
    await gotoHydrated(page, "/search");
    await page.getByLabel("Search mode", { exact: true }).selectOption("keyword");
    const input = page.getByRole("textbox", { name: "Search photos" });
    await input.fill("japan");

    // Wait for the committed result set, not merely for some tile to be on
    // screen: a grid still swapping placeholder rows could re-render the very
    // tile under the pointer.
    await expectJapanResults(page);
    await expect(input).toHaveAttribute("aria-busy", "false");

    const videoResult = page.locator(`a[href="${clipResultHref}"]`).first();
    await expect(videoResult).toBeVisible();

    // Nothing is mounted — let alone fetched — before a pointer arrives.
    await expect(page.locator("video")).toHaveCount(0);

    await videoResult.locator("img").first().hover();

    const preview = videoResult.locator("video");
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute("src", clipPreviewSrc);

    // Proof it is actually playing, not a video element parked at zero.
    await expect
      .poll(() => preview.evaluate((element) => (element as HTMLVideoElement).currentTime))
      .toBeGreaterThan(0);

    // Leaving the thumbnail pauses the element in place.
    await page.mouse.move(0, 0);
    await expect(preview).toHaveJSProperty("paused", true);
  });

  /*
   * The gate: a photograph in the very same grid has no clip to play, so
   * hovering it mounts nothing. The result set is asserted first, both to know
   * the grid is settled and to know the clip really is one of its neighbours.
   */
  test("hovering a photograph beside the clip mounts no preview", async ({ page }) => {
    await gotoHydrated(page, "/search");
    await page.getByLabel("Search mode", { exact: true }).selectOption("keyword");
    const input = page.getByRole("textbox", { name: "Search photos" });
    await input.fill("japan");
    await expectJapanResults(page);
    await expect(input).toHaveAttribute("aria-busy", "false");

    const photoResult = page.locator(`a[href="${photoResultHref}"]`).first();
    await expect(photoResult).toBeVisible();
    await photoResult.locator("img").first().hover();

    // Proof the pointer really landed on the tile: without this the absence
    // below would pass on a hover that never reached the element.
    await expect
      .poll(() => photoResult.evaluate((element) => element.matches(":hover")))
      .toBe(true);
    await expect(page.locator("video")).toHaveCount(0);

    // …and the grid does answer the same event, on the clip beside it: the
    // photograph is inert because it has nothing to play, not because hover is
    // broken here.
    const clipResult = page.locator(`a[href="${clipResultHref}"]`).first();
    await clipResult.locator("img").first().hover();
    await expect(clipResult.locator("video")).toHaveCount(1);
    await expect(photoResult.locator("video")).toHaveCount(0);
  });

  test("tag facet filters results", async ({ page }) => {
    await gotoHydrated(page, "/search");
    await page.getByLabel("Search mode", { exact: true }).selectOption("keyword");

    // Wait for the facet panel's "Tags" tab — needs DB to load via WASM first
    await expect(page.getByRole("tab", { name: "Tags", selected: true })).toBeVisible({
      timeout: 15_000,
    });

    const tagPanel = page.getByRole("tabpanel", { name: "Tags" });
    const japanTag = tagPanel.getByRole("button", { name: /^japan\b/i });
    await expect(japanTag).toBeVisible({ timeout: 15_000 });
    await japanTag.click();

    await expect(japanTag).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === "japan");
    await expectJapanResults(page);
  });

  test("compact filters open as a native modal and restore focus", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await gotoHydrated(page, "/search");

    const trigger = page.getByRole("button", { name: "Filters" });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Search filters" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty("open", true);
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(page.getByRole("button", { name: "Done" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("similar mode queries the production-format embeddings database", async ({ page }) => {
    await gotoHydrated(page, "/search?similar=../albums/test-simple/DSCF0506-2.jpg");

    await expect(page).toHaveURL(/similar=/);
    // The source context appears before the lazy embeddings DB finishes loading.
    await expect(page.getByText("Similar to")).toBeVisible();
    await expect(page.getByText("DSCF0506-2.jpg")).toBeVisible();

    const resultPictures = page.getByTestId("result-picture");
    // Every fixture row but the seed, which now includes the album's clip.
    await expect(resultPictures).toHaveCount(5, { timeout: 15_000 });
    const firstResultHref = await resultPictures
      .first()
      .evaluate((picture) => picture.closest("a")?.getAttribute("href"));
    // The closest vector belongs to the last inserted fixture row. This cannot
    // pass through stable insertion order if blob decoding or ranking breaks.
    expect(firstResultHref).toBe("/album/test-simple#DSCF2768.JPG");
  });
});
