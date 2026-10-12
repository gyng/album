import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

test("Explore groups archive views and preserves filtered timeline links", async ({ page }) => {
  await gotoHydrated(page, "/explore");
  const subnav = page.getByRole("navigation", { name: "Explore views" });
  await expect(subnav.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await subnav.getByRole("link", { name: "Timeline" }).click();
  await expect(page).toHaveURL(/\/explore\/timeline$/);
  await expect(subnav.getByRole("link", { name: "Timeline" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await gotoHydrated(page, "/timeline?filter_album=test-simple&date=2019-11-06");
  await expect(page).toHaveURL(/\/explore\/timeline\?filter_album=test-simple&date=2019-11-06$/);
  await expect(page.getByRole("heading", { name: "Timeline", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/explore");
  const right = await subnav.evaluate((element) => element.getBoundingClientRect().right);
  expect(right).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("weather and framing facets survive a reload and constrain search results", async ({
  page,
}) => {
  await gotoHydrated(
    page,
    "/search?facet=weather-condition%3AMostly%20clear&facet=aspect-ratio%3A3%3A2",
  );
  await expect(page.getByRole("button", { name: /Conditions: Mostly clear/ })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("button", { name: /Aspect ratio: 3:2/ })).toBeVisible();
  const results = page.locator("ul[aria-busy]");
  await expect(results).toHaveAttribute("aria-busy", "false");
  await expect(results.locator('a[href="/album/test-simple#DSCF2768.JPG"]')).toBeVisible();
  await expect(results.locator('a[href="/album/test-simple#DSCF2485-2.jpg"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-app-hydrated", "true");
  await expect(page.getByRole("button", { name: /Conditions: Mostly clear/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Aspect ratio: 3:2/ })).toBeVisible();
});
