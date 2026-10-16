import { expect, test } from "@playwright/test";

const photoPath = "../albums/test-simple/DSCF0506-2.jpg";
/* The visible slide inside the runtime frame: the <img> loading a photo (or a
 * clip's poster frame) or the <video> playing a clip. */
const slideshowSlide = '[data-media-kind]:not([aria-hidden="true"])';
/* The same slide restricted to the still <img> — for the checks that need a
 * decoded image's naturalWidth. */
const slideshowPhoto = 'img[data-media-kind]:not([aria-hidden="true"])';

test("the installed slideshow shell and runtime restart offline with its configured URL", async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);
  test.skip(
    test.info().project.name !== "chromium",
    "Offline service-worker lifecycle coverage runs once in Chromium",
  );

  // clips=0 keeps this offline journey on photographs: the pool also contains a
  // clip, which would otherwise render as a <video> on a random advance and
  // make the still-only assertions below non-deterministic.
  const configuredUrl = `/slideshow/shell?mode=random&filter=test-simple&delay=86400&clips=0&photo=${encodeURIComponent(photoPath)}`;
  await page.goto(configuredUrl, { waitUntil: "domcontentloaded" });
  const runtime = page.frameLocator('iframe[title="Slideshow"]');

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
    });
  });

  // Reload once under worker control so the configured E2E database and shell
  // runtime are stored by the same paths production uses.
  await page.goto(configuredUrl, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle("Slideshow | Snapshots", { timeout: 15_000 });
  await expect(runtime.locator(slideshowSlide).first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => caches.has("snapshots-pwa-images"))).toBe(false);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open("snapshots-slideshow-recent-v1");
        return (await cache.keys()).some((request) => request.url.includes("DSCF0506-2"));
      }),
    )
    .toBe(true);
  const secondUrl = configuredUrl.replace(
    encodeURIComponent(photoPath),
    encodeURIComponent("../albums/test-simple/DSCF0593.jpg"),
  );
  await page.goto(secondUrl, { waitUntil: "domcontentloaded" });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open("snapshots-slideshow-recent-v1");
        return (await cache.keys()).some((request) => request.url.includes("DSCF0593"));
      }),
    )
    .toBe(true);
  await page.goto(configuredUrl, { waitUntil: "domcontentloaded" });

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Slideshow | Snapshots", { timeout: 15_000 });
    // The recently displayed photograph has an explicit bounded fallback.
    await expect(page.locator('iframe[title="Slideshow"]')).toHaveAttribute("data-ready", "true", {
      timeout: 15_000,
    });
    await expect
      .poll(() =>
        runtime
          .locator(slideshowPhoto)
          .first()
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    const before = await runtime.locator(slideshowSlide).first().getAttribute("src");
    await page.mouse.move(100, 10);
    await runtime.getByRole("button", { name: "Next", exact: true }).click();
    await expect
      .poll(() => runtime.locator(slideshowSlide).last().getAttribute("src"))
      .not.toBe(before);
    await expect
      .poll(() =>
        runtime
          .locator(slideshowPhoto)
          .last()
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    await expect(runtime.getByRole("group", { name: "Playback mode" })).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await context.setOffline(false);
  }
});
