import { test, expect } from "@playwright/test";
import { stubExternalMapAssets } from "./map-network";

test.describe("Smoke Tests", () => {
  let pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await stubExternalMapAssets(page);
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("homepage loads with albums and navigation", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

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
    await page.goto("/album/test-simple", { waitUntil: "domcontentloaded" });

    await expect(page.locator('a:has-text("Albums")')).toBeVisible();
    await expect(page.locator('a:has-text("Album map")')).toBeVisible();
    await expect(page.locator('a:has-text("Album slideshow")')).toBeVisible();

    const photos = page.locator("img");
    await expect(photos.first()).toBeVisible();
    expect(await photos.count()).toBeGreaterThan(0);
  });

  test("map page loads with canvas", async ({ page }) => {
    await page.goto("/map", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Map | Snapshots");
    await expect(page.locator("canvas").first()).toBeVisible();
  });

  test("search page loads", async ({ page, browserName }) => {
    test.skip(browserName === "chromium", "Covered by the full Chromium search suite");
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /search/i })).toBeVisible();
  });

  test("explore page loads with sections", async ({ page }) => {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/Explore/);
    await expect(page.getByRole("heading", { name: "Explore" })).toBeVisible();

    // Jump nav and at least one data section render
    await expect(page.locator('nav[aria-label="Jump to section"]')).toBeVisible();
  });

  test("timeline page loads", async ({ page, browserName }) => {
    test.skip(browserName === "chromium", "Covered by the full Chromium timeline suite");
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  });

  test("album navigation flow works", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

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
    await page.goto("/map?filter_album=test-simple", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Map | Snapshots");

    // Filter indicator toast appears with album name
    await expect(page.locator("i", { hasText: "test-simple" })).toBeVisible();
    expect(page.url()).toContain("filter_album=test-simple");
  });

  test("photo deep-link scrolls to photo", async ({ page }) => {
    await page.goto("/album/test-simple#DSCF0506-2.jpg", { waitUntil: "domcontentloaded" });

    // The photo element with matching ID should be in the viewport
    const photo = page.locator('[id="DSCF0506-2.jpg"]');
    await expect(photo).toBeVisible();
    await expect(photo).toBeInViewport();
  });

  test("slideshow page loads", async ({ page, browserName }) => {
    test.skip(browserName === "chromium", "Covered by the full Chromium slideshow suite");
    await page.goto("/slideshow", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Slideshow | Snapshots");
    await expect(page.locator('img[alt]:not([aria-hidden="true"])').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("theme toggle changes theme", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const html = page.locator("html");
    const initialClass = await html.getAttribute("class");

    await page.getByRole("button", { name: /switch to (light|dark) theme/i }).click();

    await expect(html).not.toHaveAttribute("class", initialClass ?? "");
  });
});
