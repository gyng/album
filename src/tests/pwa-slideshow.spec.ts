import { expect, test } from "@playwright/test";

const photoPath = "../albums/test-simple/DSCF0506.jpg";
const slideshowImage = 'img[alt]:not([aria-hidden="true"])';

test("the installed slideshow shell restarts offline with its configured URL", async ({
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

  // Reload once under worker control so the configured E2E database and the
  // selected photo are both stored by the same paths production uses.
  await page.goto(configuredUrl, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle("Slideshow | Snapshots", { timeout: 15_000 });
  await expect(runtime.locator(slideshowImage).first()).toBeVisible({ timeout: 15_000 });

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Slideshow | Snapshots", { timeout: 15_000 });
    await expect(runtime.locator(slideshowImage).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await context.setOffline(false);
  }
});
