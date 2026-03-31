import { test, expect } from "@playwright/test";
import { existsSync, statSync } from "fs";
import { join } from "path";

const searchDbPath = join(__dirname, "..", "public", "search.sqlite");
const hasSearchDb =
  existsSync(searchDbPath) && statSync(searchDbPath).size > 0;

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
    await page.goto("/search");

    await expect(page.getByRole("heading", { name: /search/i })).toBeVisible();

    // Browse mode explore section renders
    await expect(page.getByLabel("Explore browse mode")).toBeVisible();
  });

  test("search accepts a query and updates URL", async ({ page }) => {
    await page.goto("/search");

    const input = page.locator('input[placeholder*="Type / to search"]');
    await expect(input).toBeVisible();

    await input.fill("tokyo");
    await expect(page).toHaveURL(/q=tokyo/);
  });

  test("keyword search returns results", async ({ page }) => {
    test.skip(!hasSearchDb, "Requires search.sqlite");

    await page.goto("/search");

    // Use keyword mode to avoid WebGPU dependency
    await page
      .getByLabel("Search mode", { exact: true })
      .selectOption("keyword");

    const input = page.locator('input[placeholder*="Type / to search"]');
    await input.fill("japan");
    await expect(page).toHaveURL(/q=japan/);

    // Result tile images appear
    const results = page.locator("img");
    await expect(results.first()).toBeVisible();
    expect(await results.count()).toBeGreaterThan(0);
  });

  test("tag facet filters results", async ({ page }) => {
    test.skip(!hasSearchDb, "Requires search.sqlite");

    await page.goto("/search");

    // Wait for the facet panel's "Tags" tab — needs DB to load via WASM first
    await expect(
      page.getByRole("tab", { name: "Tags", selected: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Click the first tag pill button (tags load after WASM DB init)
    const tagPill = page.locator('[class*="pill"]').first();
    await expect(tagPill).toBeVisible({ timeout: 15_000 });
    await tagPill.click();

    // URL updates with the tag query
    await expect(page).toHaveURL(/q=/);
  });

  test("similar mode loads source photo context", async ({ page }) => {
    await page.goto("/search?similar=../albums/test-simple/DSCF0506-2.jpg");

    await expect(page).toHaveURL(/similar=/);
    // Similar-to header and filename appear immediately (before DB loads)
    await expect(page.getByText("Similar to")).toBeVisible();
    await expect(page.getByText("DSCF0506-2.jpg")).toBeVisible();
  });
});
