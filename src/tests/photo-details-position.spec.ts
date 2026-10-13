import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

test("details opened midway through a photo remain below their trigger and fully usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoHydrated(page, "/album/test-simple");
  const photo = page.getByTestId("photoblockel").first();
  const toggle = photo.getByLabel("Photo details", { exact: true });
  const panel = toggle.locator("..").locator(":scope > div");
  const box = (await photo.boundingBox())!;
  await page.evaluate((y) => window.scrollTo(0, y), box.y + box.height / 2);
  await page.mouse.wheel(0, 30);
  await expect(page.getByRole("navigation").first()).not.toBeInViewport();
  await expect(toggle).toBeInViewport({ ratio: 1 });
  const before = (await toggle.boundingBox())!;
  const scrollBefore = await page.evaluate(() => scrollY);
  // A direct click preserves the halfway position; locator.click scrolls sticky
  // controls back into their original document position before clicking them.
  await page.mouse.click(before.x + before.width / 2, before.y + 14);
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await toggle.boundingBox())!.y).toBeCloseTo(before.y, 0);
  const opened = (await panel.boundingBox())!;
  expect(opened.y).toBeGreaterThanOrEqual(before.y + before.height);
  expect(opened.y + opened.height).toBeLessThanOrEqual(900);
  expect(
    await panel.evaluate((element) =>
      element.contains(
        document.elementFromPoint(
          element.getBoundingClientRect().right - 24,
          element.getBoundingClientRect().bottom - 24,
        ),
      ),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
  await page.mouse.click(before.x + before.width / 2, before.y + 14);
  await expect(panel).toHaveCount(0);
  expect((await toggle.boundingBox())!.y).toBeCloseTo(before.y, 0);
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
});
