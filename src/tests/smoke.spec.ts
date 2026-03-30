import { test, expect } from "@playwright/test";

test.describe("Smoke Tests", () => {
  let pageErrors: string[] = [];

  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("homepage loads with albums and navigation", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Snapshots");
    await expect(page.locator("h1")).toContainText("Snapshots");

    // Navigation links
    await expect(page.locator('a[href="/map"]')).toBeVisible();
    await expect(page.locator('a[href="/timeline"]')).toBeVisible();
    await expect(page.locator('a[href="/search"]')).toBeVisible();
    await expect(page.locator('a[href="/slideshow"]')).toBeVisible();

    // At least one album
    await expect(page.locator('a[href*="/album/"]').first()).toBeVisible();
  });

  test("album page loads with nav and photos", async ({ page }) => {
    await page.goto("/album/test-simple");

    await expect(page.locator('a:has-text("Albums")')).toBeVisible();
    await expect(page.locator('a:has-text("Album map")')).toBeVisible();
    await expect(page.locator('a:has-text("Album slideshow")')).toBeVisible();

    const photos = page.locator("img");
    await expect(photos.first()).toBeVisible();
    expect(await photos.count()).toBeGreaterThan(0);
  });

  test("map page loads with canvas", async ({ page }) => {
    await page.goto("/map");
    await expect(page).toHaveTitle("Map | Snapshots");
    await expect(page.locator("canvas").first()).toBeVisible();
  });

  test("search page loads", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: /search/i })).toBeVisible();
  });

  test("explore page loads", async ({ page }) => {
    await page.goto("/explore");
    await expect(page).toHaveTitle(/Explore/);
  });

  test("timeline page loads", async ({ page }) => {
    await page.goto("/timeline");
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  });

  test("album navigation flow works", async ({ page }) => {
    await page.goto("/");

    // Click into an album
    const albumLink = page.locator('a[href="/album/test-simple"]').first();
    await expect(albumLink).toBeVisible();
    await albumLink.click();
    await page.waitForURL("/album/test-simple");

    // Photos are visible
    await expect(page.locator("img").first()).toBeVisible();

    // Navigate back via "Albums" link
    await page.locator('a:has-text("Albums")').click();
    await page.waitForURL("/");
    await expect(page.locator("h1")).toContainText("Snapshots");
  });

  test("map album filter shows indicator", async ({ page }) => {
    await page.goto("/map?filter_album=test-simple");
    await expect(page).toHaveTitle("Map | Snapshots");

    // Filter indicator toast appears with album name
    await expect(page.locator("i", { hasText: "test-simple" })).toBeVisible();
    expect(page.url()).toContain("filter_album=test-simple");
  });

  test("theme toggle changes theme", async ({ page }) => {
    await page.goto("/");

    const html = page.locator("html");
    const initialTheme = await html.getAttribute("data-theme");

    await page.locator('button[title="Toggle dark mode"]').click();

    await expect(html).not.toHaveAttribute("data-theme", initialTheme ?? "");
  });
});
