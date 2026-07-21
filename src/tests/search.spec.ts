import { test, expect } from "@playwright/test";

const expectedJapanResultHrefs = [
  "/album/test-simple#DSCF0506-2.jpg",
  "/album/test-simple#DSCF0593.jpg",
];

const expectJapanResults = async (page: import("@playwright/test").Page) => {
  const resultPictures = page.getByTestId("result-picture");
  await expect(resultPictures).toHaveCount(2, { timeout: 15_000 });
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
    await page.goto("/search", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /search/i })).toBeVisible();

    // Browse mode explore section renders
    await expect(page.getByLabel("Explore browse mode")).toBeVisible();
  });

  test("keyword search returns only matching results", async ({ page }) => {
    await page.goto("/search", { waitUntil: "domcontentloaded" });

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

  test("tag facet filters results", async ({ page }) => {
    await page.goto("/search", { waitUntil: "domcontentloaded" });
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
    await page.goto("/search", { waitUntil: "domcontentloaded" });

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
    await page.goto("/search?similar=../albums/test-simple/DSCF0506-2.jpg", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/similar=/);
    // The source context appears before the lazy embeddings DB finishes loading.
    await expect(page.getByText("Similar to")).toBeVisible();
    await expect(page.getByText("DSCF0506-2.jpg")).toBeVisible();

    const resultPictures = page.getByTestId("result-picture");
    await expect(resultPictures).toHaveCount(4, { timeout: 15_000 });
    const firstResultHref = await resultPictures
      .first()
      .evaluate((picture) => picture.closest("a")?.getAttribute("href"));
    // The closest vector belongs to the last inserted fixture row. This cannot
    // pass through stable insertion order if blob decoding or ranking breaks.
    expect(firstResultHref).toBe("/album/test-simple#DSCF2768.JPG");
  });
});
