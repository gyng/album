import { test, expect } from "@playwright/test";

test("debug homepage selectors", async ({ page }) => {
  await page.goto("/");

  // Wait for page to load
  await page.waitForLoadState("networkidle");

  // Log all links on the page
  const links = await page.locator("a").all();
  console.log("All links found:");
  for (const link of links) {
    const href = await link.getAttribute("href");
    const text = await link.textContent();
    console.log(`- Text: "${text?.trim()}" | Href: ${href}`);
  }

  // Specifically look for map and slideshow links
  const mapLinks = await page
    .locator('a:has-text("Map"), a[href*="map"]')
    .all();
  console.log("\nMap links found:", mapLinks.length);
  for (const link of mapLinks) {
    const href = await link.getAttribute("href");
    const text = await link.textContent();
    console.log(`- Map link: "${text?.trim()}" | Href: ${href}`);
  }

  const slideshowLinks = await page
    .locator('a:has-text("Slideshow"), a[href*="slideshow"]')
    .all();
  console.log("\nSlideshow links found:", slideshowLinks.length);
  for (const link of slideshowLinks) {
    const href = await link.getAttribute("href");
    const text = await link.textContent();
    console.log(`- Slideshow link: "${text?.trim()}" | Href: ${href}`);
  }
});
