import { test, expect } from "@playwright/test";

test.describe("Search Functionality", () => {
  test("browse mode exposes zero-query exploration", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/search");

    await expect(page.getByLabel("Explore browse mode")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Explore the map" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open slideshow" }),
    ).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/map$/),
      page.getByRole("link", { name: "Explore the map" }).click(),
    ]);

    await expect(page).toHaveTitle("Map | Snapshots");
    expect(pageErrors).toEqual([]);
  });

  test("browse mode opens slideshow via explore action", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/search");

    await expect(page.getByLabel("Explore browse mode")).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/slideshow$/),
      page.getByRole("link", { name: "Open slideshow" }).click(),
    ]);

    await expect(page.getByRole("button", { name: /random/i })).toBeVisible();
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

    await expect(randomTrailButton).toBeEnabled();

    await Promise.all([
      page.waitForURL(/\/slideshow\?mode=similar&seed=/),
      randomTrailButton.click(),
    ]);

    await expect(page.getByText("Similar mode")).toBeVisible();
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
    ).toBeVisible();

    const input = page.locator('input[placeholder*="Type / to search"]');
    await expect(input).toBeVisible();

    await input.fill("tokyo");
    await expect(page).toHaveURL(/q=tokyo/);
    expect(pageErrors).toEqual([]);
  });

  test("similar mode shows source photo and visible match scores", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/search?similar=../albums/test-simple/DSCF0506-2.jpg");

    await expect(page).toHaveURL(/similar=/);
    await expect(page.getByText("Similar photos")).toBeVisible();
    await expect(page.getByText("Comparing against")).toBeVisible();
    await expect(page.getByText("DSCF0506-2.jpg")).toBeVisible();
    await expect(page.getByRole("img", { name: /source photo/i })).toBeVisible();
    await expect(page.locator("text=/% match$/").first()).toBeVisible();

    const similarButton = page.getByRole("button", {
      name: /find similar photos/i,
    });
    await expect(similarButton.first()).toBeVisible();
    await similarButton.first().click();

    await expect(page.getByLabel("Similarity breadcrumbs")).toBeVisible();
    await expect(
      page.locator('[aria-label="Similarity breadcrumbs"] img').first(),
    ).toBeVisible();
    await expect(
      page.locator('[aria-label="Similarity breadcrumbs"] a').last(),
    ).toHaveAttribute("href", /\/album\/test-simple#DSCF0506-2\.jpg$/);
    expect(pageErrors).toEqual([]);
  });
});
