import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

const expectDensity = async (page: Page, density: string, height: number) => {
  const controls = page.locator(`[data-control-density="${density}"]`).locator(":scope > *");
  expect(await controls.count()).toBeGreaterThan(3);
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.height - height)).toBeLessThan(1);
  }
};

for (const theme of ["light", "darkroom", "slate"]) {
  test(`shared control sizes remain aligned in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoHydrated(page, `/design?theme=${theme}`);
    await expectDensity(page, "standard", 44);
    await expectDensity(page, "compact", 32);
    const input = page.getByRole("textbox", { name: "Standard density search" });
    await input.focus();
    expect(await input.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  });
}

test.describe("touch density", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("compact controls retain touch targets and the catalogue fits", async ({ page }) => {
    await gotoHydrated(page, "/design?theme=darkroom");
    await expectDensity(page, "standard", 44);
    await expectDensity(page, "compact", 44);
    const fontSize = await page
      .getByRole("textbox", { name: "Standard density search" })
      .evaluate((element) => getComputedStyle(element).fontSize);
    expect(fontSize).toBe("16px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});

test("photo details stay within a readable desktop and mobile width", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoHydrated(page, "/album/test-simple?theme=darkroom");
    const toggle = page.getByLabel("Photo details", { exact: true }).first();
    await toggle.click();
    const panel = toggle.locator("..").locator(":scope > div");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    const readingWidth = await page.evaluate(
      () => 30 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    expect(box!.width).toBeLessThanOrEqual(Math.min(readingWidth, width - 48));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
});
