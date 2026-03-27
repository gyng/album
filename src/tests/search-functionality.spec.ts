import { test, expect } from "@playwright/test";

test.describe("Search Functionality", () => {
  test("browse mode exposes zero-query exploration", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/search");

    await expect(page.getByLabel("Explore browse mode")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("link", { name: "Explore the map" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("link", { name: "Open slideshow" }),
    ).toBeVisible({ timeout: 15000 });

    await Promise.all([
      page.waitForURL(/\/map$/, { timeout: 15000 }),
      page.getByRole("link", { name: "Explore the map" }).click(),
    ]);

    await expect(page).toHaveTitle("Map");
    expect(pageErrors).toEqual([]);
  });

  test("browse mode opens slideshow via explore action", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/search");

    await expect(page.getByLabel("Explore browse mode")).toBeVisible({
      timeout: 15000,
    });

    await Promise.all([
      page.waitForURL(/\/slideshow$/, { timeout: 15000 }),
      page.getByRole("link", { name: "Open slideshow" }).click(),
    ]);

    await expect(page.getByRole("button", { name: /random/i })).toBeVisible({
      timeout: 15000,
    });
    expect(pageErrors).toEqual([]);
  });

  test("browse mode starts a random similarity trail", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/search");

    const randomTrailButton = page.getByRole("button", {
      name: "Random similarity trail",
    });

    await expect(randomTrailButton).toBeEnabled({ timeout: 15000 });

    await Promise.all([
      page.waitForURL(/\/slideshow\?mode=similar&seed=/, { timeout: 15000 }),
      randomTrailButton.click(),
    ]);

    await expect(page.getByText("Similar mode")).toBeVisible({
      timeout: 15000,
    });
    expect(pageErrors).toEqual([]);
  });

  test("search page loads and accepts a query", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/search");

    await expect(
      page.getByRole("heading", { name: /search & explore/i }),
    ).toBeVisible({
      timeout: 15000,
    });

    const input = page.locator('input[placeholder*="Type / to search"]');
    await expect(input).toBeVisible({ timeout: 15000 });

    await input.fill("tokyo");
    await expect(page).toHaveURL(/q=tokyo/, { timeout: 10000 });
    expect(pageErrors).toEqual([]);
  });

  test("similar mode shows source photo and visible match scores", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/search?similar=../albums/2511japan/DSCF6007-06.jpg");

    await expect(page).toHaveURL(/similar=/, { timeout: 10000 });
    await expect(page.getByText("Similar photos")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Comparing against")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("DSCF6007-06.jpg")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("img", { name: /source photo/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=/% match$/").first()).toBeVisible({
      timeout: 20000,
    });

    const similarButton = page.getByRole("button", {
      name: /find similar photos/i,
    });
    await expect(similarButton.first()).toBeVisible({ timeout: 20000 });
    await similarButton.first().click();

    await expect(page.getByLabel("Similarity breadcrumbs")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator('[aria-label="Similarity breadcrumbs"] img').first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('[aria-label="Similarity breadcrumbs"] a').last(),
    ).toHaveAttribute("href", /\/album\/2511japan#DSCF6007-06\.jpg$/);
    expect(pageErrors).toEqual([]);
  });
});
