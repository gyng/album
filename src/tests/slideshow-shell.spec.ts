import { expect, test } from "@playwright/test";

const slideshowImage = 'img[alt]:not([aria-hidden="true"])';

test("the slideshow shell swaps code without releasing its wake lock", async ({ page }) => {
  test.setTimeout(45_000);
  await page.addInitScript(() => {
    const state = window as Window & {
      __wakeLockReleaseCount?: number;
      __wakeLockRequestCount?: number;
    };
    state.__wakeLockReleaseCount = 0;
    state.__wakeLockRequestCount = 0;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          state.__wakeLockRequestCount = (state.__wakeLockRequestCount ?? 0) + 1;
          const sentinel = new EventTarget() as EventTarget & { release: () => Promise<void> };
          sentinel.release = async () => {
            state.__wakeLockReleaseCount = (state.__wakeLockReleaseCount ?? 0) + 1;
            sentinel.dispatchEvent(new Event("release"));
          };
          return sentinel;
        },
      },
    });
  });

  await page.goto("/slideshow/shell?mode=random&delay=86400", {
    waitUntil: "domcontentloaded",
  });

  const diagnostics = page.getByRole("group", { name: "Slideshow diagnostics" });
  await expect(diagnostics).toHaveAttribute("data-code-status", "current");
  await page.getByRole("button", { name: "Slideshow diagnostics" }).click();
  await expect(diagnostics.getByText("Screen awake")).toBeVisible();

  const runtime = page.frameLocator('iframe[title="Slideshow"]');
  const image = runtime.locator(slideshowImage).first();
  await expect(image).toBeVisible({ timeout: 15_000 });
  const photoBeforeUpdate = await image.getAttribute("src");
  expect(
    await runtime
      .locator("body")
      .evaluate(
        () => (window as Window & { __wakeLockRequestCount?: number }).__wakeLockRequestCount ?? 0,
      ),
  ).toBe(0);
  await expect(runtime.getByRole("button", { name: "Screen stays awake" })).toBeVisible();

  await page.route("**/version.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ buildVersion: "future-build" }),
    });
  });
  await diagnostics.getByRole("button", { name: "Check for code update" }).click();

  await expect(page.locator('iframe[title="Slideshow"]')).toHaveAttribute(
    "src",
    /shellVersion=future-build/,
  );
  await expect(image).toBeVisible({ timeout: 15_000 });
  await expect(image).toHaveAttribute("src", String(photoBeforeUpdate));
  await runtime.locator("body").evaluate(() => {
    window.parent.postMessage(
      {
        type: "snapshots:slideshow-ready",
        buildVersion: "future-build",
        search: window.location.search,
      },
      window.location.origin,
    );
  });
  await expect(diagnostics).toHaveAttribute("data-code-status", "current");
  expect(
    await page.evaluate(
      () => (window as Window & { __wakeLockReleaseCount?: number }).__wakeLockReleaseCount,
    ),
  ).toBe(0);
});

test("wake-lock failure never blocks the embedded slideshow", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => Promise.reject(new Error("wake lock denied")) },
    });
  });

  await page.goto("/slideshow/shell?mode=random&delay=86400", {
    waitUntil: "domcontentloaded",
  });
  const prompt = page.getByRole("button", {
    name: "Tap once to keep this slideshow awake through code updates",
  });
  await expect(prompt).toBeVisible();
  await prompt.click();
  await expect(prompt).toBeHidden();

  const runtime = page.frameLocator('iframe[title="Slideshow"]');
  await expect(runtime.locator(slideshowImage).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Slideshow diagnostics" }).click();
  await expect(page.getByText("Wake lock off")).toBeVisible();
});

test("slideshow exit controls leave the outer shell", async ({ page }) => {
  await page.goto("/slideshow/shell?mode=random&delay=86400", {
    waitUntil: "domcontentloaded",
  });
  const runtime = page.frameLocator('iframe[title="Slideshow"]');
  await expect(runtime.locator(slideshowImage).first()).toBeVisible({ timeout: 15_000 });
  const wakePrompt = page.getByRole("button", {
    name: "Tap once to keep this slideshow awake through code updates",
  });
  if (await wakePrompt.isVisible()) {
    await wakePrompt.click();
  }

  await runtime.getByRole("link", { name: /Snapshots Slideshow/ }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('iframe[title="Slideshow"]')).toHaveCount(0);
});

test("slideshow context links leave the outer shell", async ({ page }) => {
  await page.goto("/slideshow/shell?mode=random&delay=86400", {
    waitUntil: "domcontentloaded",
  });
  const runtime = page.frameLocator('iframe[title="Slideshow"]');
  await expect(runtime.locator(slideshowImage).first()).toBeVisible({ timeout: 15_000 });
  const wakePrompt = page.getByRole("button", {
    name: "Tap once to keep this slideshow awake through code updates",
  });
  if (await wakePrompt.isVisible()) {
    await wakePrompt.click();
  }

  await runtime.getByRole("link", { name: / in / }).last().click();

  await expect(page).toHaveURL(/\/album\//);
  await expect(page.locator('iframe[title="Slideshow"]')).toHaveCount(0);
});
