import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

const expectedJapanResultHrefs = [
  // The album's committed clip is tagged japan too: it is indexed through the
  // poster frame the prepass extracts from it.
  "/album/test-simple#DSCF0159.MOV",
  "/album/test-simple#DSCF0506-2.jpg",
  "/album/test-simple#DSCF0593.jpg",
];

const expectJapanResults = async (page: import("@playwright/test").Page) => {
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
