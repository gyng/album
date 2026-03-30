import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import { join } from "path";

const hasSearchDb = existsSync(
  join(__dirname, "..", "public", "search.sqlite"),
);

test.describe("Search", () => {
  test("search page loads with explore section", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/search");

    await expect(page.getByRole("heading", { name: /search/i })).toBeVisible();

    // Browse mode explore section renders
    await expect(page.getByLabel("Explore browse mode")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("search accepts a query and updates URL", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/search");

    const input = page.locator('input[placeholder*="Type / to search"]');
    await expect(input).toBeVisible();

    await input.fill("tokyo");
    await expect(page).toHaveURL(/q=tokyo/);

    expect(pageErrors).toEqual([]);
  });

  test("keyword search returns results", async ({ page }) => {
    test.skip(!hasSearchDb, "Requires search.sqlite");

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

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

    expect(pageErrors).toEqual([]);
  });

  test("tag facet filters results", async ({ page }) => {
    test.skip(!hasSearchDb, "Requires search.sqlite");

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/search");

    // Wait for tag cloud to load
    const tagButton = page.locator("button[aria-pressed]").first();
    await expect(tagButton).toBeVisible();

    // Click a tag
    await tagButton.click();

    // URL updates with the tag and button becomes active
    await expect(tagButton).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/q=/);

    expect(pageErrors).toEqual([]);
  });

  test("similar mode loads source photo context", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/search?similar=../albums/test-simple/DSCF0506-2.jpg");

    await expect(page).toHaveURL(/similar=/);
    // Similar-to header and filename appear immediately (before DB loads)
    await expect(page.getByText("Similar to")).toBeVisible();
    await expect(page.getByText("DSCF0506-2.jpg")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
