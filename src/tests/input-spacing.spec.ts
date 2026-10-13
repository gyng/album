import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

for (const width of [390, 1280]) {
  test(`text inputs and search clear control have room at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoHydrated(page, "/design");
    const standard = page.getByRole("textbox", { name: "Standard density search" });
    const padding = await standard.evaluate((element) => {
      const style = getComputedStyle(element);
      return [parseFloat(style.paddingInlineStart), parseFloat(style.paddingInlineEnd)];
    });
    expect(padding).toEqual([12, 12]);

    await gotoHydrated(page, "/search?q=cat&mode=keyword");
    const input = page.getByRole("textbox", { name: "Search photos", exact: true });
    const clear = page.getByRole("button", { name: "Clear search", exact: true });
    await expect(clear).toBeVisible();
    const fieldBox = (await input.boundingBox())!;
    const clearBox = (await clear.boundingBox())!;
    expect(clearBox.width).toBeGreaterThanOrEqual(44);
    expect(clearBox.height).toBeGreaterThanOrEqual(44);
    expect(
      Math.abs(clearBox.y + clearBox.height / 2 - fieldBox.y - fieldBox.height / 2),
    ).toBeLessThan(1);
    expect(fieldBox.x + fieldBox.width - clearBox.x - clearBox.width).toBeLessThanOrEqual(2);
    const endPadding = await input.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingInlineEnd),
    );
    expect(endPadding).toBeGreaterThanOrEqual(clearBox.width + 8);
    await clear.click();
    await expect(input).toHaveValue("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
