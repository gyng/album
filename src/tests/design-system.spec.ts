import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

test("unknown document URLs use the themed gallery recovery page", async ({ page, request }) => {
  const response = await page.goto("/missing-design-review-page?theme=darkroom");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Back to album list" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-app-hydrated", "true");
  await expect(page.locator("html")).toHaveClass(/theme-darkroom/);
  const resource = await request.get("/data/missing-design-review.json", {
    headers: { accept: "application/json" },
  });
  expect(resource.status()).toBe(404);
});

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

  test("drawing tools stay inside the viewport with full touch targets", async ({ page }) => {
    await gotoHydrated(page, "/design?theme=light");
    await page.getByRole("button", { name: "Preview drawing tools" }).click();
    const dialog = page.getByRole("dialog", { name: "Draw to search" });
    await expect(dialog).toBeVisible();
    const brushes = dialog.getByRole("group", { name: "Brush colour" }).getByRole("button");
    expect(await brushes.count()).toBe(8);
    for (const brush of await brushes.all()) {
      const box = await brush.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBe(44);
      expect(box!.height).toBe(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Preview drawing tools" })).toBeFocused();
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

test("photo metadata keeps its columns while deferred content loads", async ({ page }) => {
  await gotoHydrated(page, "/album/test-simple");
  const pending: Array<() => void> = [];
  await page.route(
    "**/_next/static/**/*.js",
    (route) =>
      new Promise<void>((resolve) => {
        pending.push(() => {
          void route.continue().then(() => resolve());
        });
      }),
  );
  try {
    const toggle = page.getByLabel("Photo details", { exact: true }).first();
    await toggle.click();
    const panel = toggle.locator("..").locator(":scope > div");
    await expect(panel.getByText("Loading map…", { exact: true })).toBeVisible();
    const table = panel.locator("table").first();
    const before = await table.boundingBox();
    for (const release of pending.splice(0)) release();
    await page.unroute("**/_next/static/**/*.js");
    await expect(panel.locator(".maplibregl-map")).toBeVisible({ timeout: 15_000 });
    const after = await table.boundingBox();
    expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
    expect(Math.abs(after!.width - before!.width)).toBeLessThan(1);
  } finally {
    for (const release of pending.splice(0)) release();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("selected controls stay distinguishable in forced colours", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await gotoHydrated(page, "/design");
  // Forced colours repaint every author background as Canvas, keeping only its
  // alpha, so a soft accent surface becomes white on white.
  const pageBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const selected = page
    .getByRole("radiogroup", { name: "Standard density view" })
    .getByRole("radio", {
      checked: true,
    });
  const fill = await selected.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(fill).not.toBe(pageBackground);
  expect(fill).not.toMatch(/rgba\(.*, 0(\.\d+)?\)$/);
});

test("stat rows keep their counts aligned when only some rows have an action", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await gotoHydrated(page, "/design");
  const rows = page.locator("#status").getByText(/^(642|118)$/);
  const [first, second] = await Promise.all([rows.nth(0).boundingBox(), rows.nth(1).boundingBox()]);
  expect(Math.abs(first!.x + first!.width - (second!.x + second!.width))).toBeLessThan(1);
});
