import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import { join } from "path";

const hasEmbeddingsDb = existsSync(
  join(__dirname, "..", "public", "search-embeddings.sqlite"),
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

  test("similar mode shows source photo and find-similar buttons", async ({
    page,
  }) => {
    test.skip(!hasEmbeddingsDb, "Requires search-embeddings.sqlite");

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/search?similar=../albums/test-simple/DSCF0506-2.jpg");

    await expect(page).toHaveURL(/similar=/);
    await expect(page.getByText("Similar to")).toBeVisible();
    await expect(page.getByText("DSCF0506-2.jpg")).toBeVisible();

    // Wait for similarity results to load (WASM computation is slow)
    const resultCard = page.locator('[class*="card"]').first();
    await expect(resultCard).toBeVisible();

    // Hover to reveal action buttons, then click find-similar
    await resultCard.hover();
    const similarButton = page.locator(
      'button[aria-label="Find similar photos"]',
    );
    await expect(similarButton.first()).toBeVisible();
    await similarButton.first().click();
    await expect(page.getByLabel("Similarity breadcrumbs")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
