import { expect, test } from "@playwright/test";

const photoPath = "../albums/test-simple/DSCF0506.jpg";
const slideshowImage = 'img[alt]:not([aria-hidden="true"])';

test("the installed slideshow shell and runtime restart offline with its configured URL", async ({
  context,
  page,
}) => {
  test.skip(
    test.info().project.name !== "chromium",
    "Offline service-worker lifecycle coverage runs once in Chromium",
  );

  const configuredUrl = `/slideshow/shell?mode=random&filter=test-simple&delay=86400&photo=${encodeURIComponent(photoPath)}`;
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
  // runtime are stored by the same paths production uses. Album media
  // deliberately stays in the browser HTTP cache rather than Cache Storage.
  await page.goto(configuredUrl, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle("Slideshow | Snapshots", { timeout: 15_000 });
  await expect(runtime.locator(slideshowImage).first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => caches.has("snapshots-pwa-images"))).toBe(false);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Slideshow | Snapshots", { timeout: 15_000 });
    // The application and controls remain usable offline. Individual photos
    // are now best-effort browser-cache hits, not part of the PWA guarantee.
    await expect(runtime.getByRole("group", { name: "Playback mode" })).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await context.setOffline(false);
  }
});
