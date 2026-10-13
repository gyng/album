import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

test("finishing the initial image load does not undo deliberate scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 700 });
  let released = false;
  const pending: Array<() => Promise<void>> = [];
  await page.route("**/data/albums/test-simple/**/*.avif", (route) =>
    released
      ? route.continue()
      : new Promise<void>((resolve) => {
          pending.push(async () => {
            await route.continue();
            resolve();
          });
        }),
  );
  try {
    await gotoHydrated(page, "/album/test-simple");
    expect(await page.evaluate(() => document.readyState)).not.toBe("complete");
    const nav = page.getByRole("navigation").first();
    await page.mouse.wheel(0, 700);
    await expect(nav).not.toBeInViewport();
    released = true;
    await Promise.all(pending.splice(0).map((release) => release()));
    await page.waitForLoadState("load");
    // Let the pageshow handler and React's resulting layout settle.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(nav).not.toBeInViewport();
  } finally {
    released = true;
    await Promise.all(pending.splice(0).map((release) => release()));
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

for (const width of [390]) {
  test(`album navigation returns on upward scroll without moving content at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await gotoHydrated(page, "/album/test-simple");
    const nav = page.getByRole("navigation").first();
    const main = page.locator("#main-content");
    const documentTop = () =>
      main.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
    const before = await documentTop();
    await nav.evaluate((node) => {
      node.dataset.mountIdentity = "original";
    });
    await page.mouse.wheel(0, 700);
    await expect(nav).not.toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 680));
    await expect(nav).not.toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 650));
    await expect(nav).toBeInViewport({ ratio: 1 });
    await expect(nav).toHaveAttribute("data-mount-identity", "original");
    expect(Math.abs((await documentTop()) - before)).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.scrollTo(0, 750));
    await expect(nav).not.toBeInViewport();
    await nav
      .getByRole("link", { name: "Albums", exact: true })
      .evaluate((node: HTMLElement) => node.focus({ preventScroll: true }));
    await expect(nav).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => window.scrollTo(0, 800));
    await expect(nav).toBeInViewport({ ratio: 1 });
    expect(Math.abs((await documentTop()) - before)).toBeLessThanOrEqual(1);
    await main.evaluate((node: HTMLElement) => {
      node.tabIndex = -1;
      node.focus({ preventScroll: true });
    });
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect(nav).not.toBeInViewport();
    const beforeFocus = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("Shift+Tab");
    await expect(nav).toBeInViewport({ ratio: 1 });
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - beforeFocus)).toBeLessThanOrEqual(
      1,
    );
  });
}

test("linked photos keep the navigation visible, clear its height and respect reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 700 });
  await gotoHydrated(page, "/album/test-simple#DSCF0506-2.jpg");
  const nav = page.getByRole("navigation").first();
  await expect(nav).toBeInViewport({ ratio: 1 });
  const photo = page.locator('[id="DSCF0506-2.jpg"]');
  await expect(photo).toBeInViewport();
  const top = await photo.evaluate((node) => node.getBoundingClientRect().top);
  const bottom = await nav.evaluate((node) => node.getBoundingClientRect().bottom);
  expect(top).toBeGreaterThanOrEqual(bottom);
  await page.mouse.wheel(0, 350);
  await expect(nav).not.toBeInViewport();
  await page.mouse.wheel(0, -100);
  await expect(nav).toBeInViewport({ ratio: 1 });
});

test("desktop album navigation scrolls normally and the album title keeps its display size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoHydrated(page, "/album/test-simple");
  const title = page.getByRole("heading", { name: "test-simple", exact: true });
  const expected = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--fs-xl").trim(),
  );
  expect(await title.evaluate((element) => getComputedStyle(element).fontSize)).toBe(expected);
  const nav = page.getByRole("navigation").first();
  await page.mouse.wheel(0, 800);
  await expect(nav).not.toBeInViewport();
  await page.evaluate(() => scrollTo(0, 600));
  await expect(nav).not.toBeInViewport();
  await page.evaluate(() => scrollTo(0, 0));
  await expect(nav).toBeInViewport({ ratio: 1 });
});

test("mobile navigation remains above an open photo details panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await gotoHydrated(page, "/album/test-simple");
  const nav = page.getByRole("navigation").first();
  const toggle = page.getByLabel("Photo details", { exact: true }).first();
  await toggle.click();
  await expect(toggle.locator("..").locator(":scope > div")).toBeVisible();
  await page.mouse.wheel(0, 700);
  await expect(nav).not.toBeInViewport();
  await page.evaluate(() => scrollTo(0, 600));
  await expect(nav).toBeInViewport({ ratio: 1 });
  const link = nav.getByRole("link", { name: "Albums", exact: true });
  expect(
    await link.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
      );
    }),
  ).toBe(true);
});
