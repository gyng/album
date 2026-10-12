import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

// These cases replace network responses deliberately. A controlling worker
// bypasses page.route and can silently serve the real app instead of the fault.
// The real service-worker/offline journey lives in pwa-slideshow.spec.ts.
test.use({ serviceWorkers: "block" });

const slideshowImage = 'img[alt]:not([aria-hidden="true"])';
const updateTestUrl = `/slideshow/shell?mode=random&filter=test-simple&delay=86400&photo=${encodeURIComponent("../albums/test-simple/DSCF2485-2.jpg")}`;

test.describe("touch slideshow controls", () => {
  test.use({ hasTouch: true });

  test("touch controls hide after a shell reload even when runtime painting stops", async ({
    page,
  }) => {
    test.setTimeout(80_000);
    await page.addInitScript(() => {
      const state = window as Window & { __stallAnimationFrames?: () => void };
      const requestFrame = window.requestAnimationFrame.bind(window);
      const cancelFrame = window.cancelAnimationFrame.bind(window);
      const pending = new Set<number>();
      window.requestAnimationFrame = (callback) => {
        let id = 0;
        id = requestFrame((time) => {
          pending.delete(id);
          callback(time);
        });
        pending.add(id);
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        pending.delete(id);
        cancelFrame(id);
      };
      state.__stallAnimationFrames = () => {
        pending.forEach(cancelFrame);
        pending.clear();
        window.requestAnimationFrame = () => 0;
      };
    });
    await gotoHydrated(page, updateTestUrl);
    const frame = page.locator('iframe[title="Slideshow"]');
    await expect(frame).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-app-hydrated", "true");
    await expect(frame).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    const runtime = await (await frame.elementHandle())!.contentFrame();
    expect(runtime).not.toBeNull();
    const controls = runtime!.locator("[data-controls-visible][data-paused]");
    await expect(controls).toHaveAttribute("data-controls-visible", "true");
    await runtime!.evaluate(() => {
      (window as Window & { __stallAnimationFrames?: () => void }).__stallAnimationFrames!();
    });
    await expect(controls).toHaveAttribute("data-controls-visible", "false", { timeout: 35_000 });
    await expect(frame).toHaveAttribute("data-ready", "true");
  });
});

test("a runtime that stops reporting health recovers without releasing the parent lock", async ({
  page,
}) => {
  test.setTimeout(110_000);
  await page.addInitScript(() => {
    const state = window as Window & { __dropHealth?: boolean; __wakeReleases?: number };
    state.__wakeReleases = 0;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () =>
          Object.assign(new EventTarget(), {
            released: false,
            release: async () => {
              state.__wakeReleases = (state.__wakeReleases ?? 0) + 1;
            },
          }),
      },
    });
    window.addEventListener(
      "message",
      (event) => {
        if (state.__dropHealth && event.data?.health) event.stopImmediatePropagation();
      },
      { capture: true },
    );
  });
  await gotoHydrated(page, updateTestUrl);
  const frame = page.locator('iframe[title="Slideshow"]');
  await expect(frame).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("slideshow-shell-status") ?? "null")?.runtimeHealth
            ?.health?.presentedAt,
      ),
    )
    .toBeTruthy();
  const generation = Number(await frame.getAttribute("data-runtime-generation"));
  const photo = page.getByAltText("Last displayed photograph");
  const source = await photo.getAttribute("src");
  await page.evaluate(() => {
    (window as Window & { __dropHealth?: boolean }).__dropHealth = true;
  });
  await expect
    .poll(async () => Number(await frame.getAttribute("data-runtime-generation")), {
      timeout: 65_000,
    })
    .toBeGreaterThan(generation);
  await expect(photo).toHaveAttribute("src", source!);
  await page.evaluate(() => {
    (window as Window & { __dropHealth?: boolean }).__dropHealth = false;
  });
  await expect(frame).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  expect(
    await page.evaluate(() => (window as Window & { __wakeReleases?: number }).__wakeReleases),
  ).toBe(0);
});

test("the slideshow shell swaps code without releasing its wake lock", async ({ page }) => {
  test.setTimeout(45_000);
  // The corner status pill is opt-in — a kiosk shows photos, not a build hash —
  // and this test drives the panel behind it, so it asks for the pill the same
  // way the diagnostics page does.
  await page.addInitScript(() => {
    window.localStorage.setItem("slideshow-status-pill", "on");
  });
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

  await gotoHydrated(page, updateTestUrl);

  const diagnostics = page.getByRole("group", { name: "Slideshow diagnostics" });
  // Readiness now includes database/image decode, not just mounting JavaScript.
  await expect(diagnostics).toHaveAttribute("data-code-status", "current", { timeout: 20_000 });
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
        presentation: {
          sources: [
            document
              .querySelector<HTMLImageElement>('img[alt]:not([aria-hidden="true"])')!
              .getAttribute("src")!,
          ],
          cover: false,
        },
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

test("a blank code update keeps the last photograph and recovers without releasing the lock", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem("slideshow-status-pill", "on");
    const state = window as Window & { __wakeReleases?: number };
    state.__wakeReleases = 0;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () =>
          Object.assign(new EventTarget(), {
            release: async () => {
              state.__wakeReleases = (state.__wakeReleases ?? 0) + 1;
            },
          }),
      },
    });
  });
  await gotoHydrated(page, updateTestUrl);
  const diagnostics = page.getByRole("group", { name: "Slideshow diagnostics" });
  const frame = page.locator('iframe[title="Slideshow"]');
  await expect(diagnostics).toHaveAttribute("data-code-status", "current", { timeout: 20_000 });
  const lastPhoto = page.getByAltText("Last displayed photograph");
  await expect
    .poll(() => lastPhoto.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  const source = await lastPhoto.getAttribute("src");
  const originalVersion = (await (await page.request.get("/version.json")).json())
    .buildVersion as string;
  let advertisedVersion = "synthetic-update";
  await page.route("**/version.json", (route) =>
    route.fulfill({ json: { buildVersion: advertisedVersion } }),
  );
  let broken = true;
  await page.route("**/slideshow?**shellVersion=**", async (route) => {
    if (!broken) {
      await route.continue();
      return;
    }
    // Mimic the original bug: JavaScript boots and reports its build, but the
    // photo/database part never arrives. A wake-lock shim alone cannot catch it.
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="background:black"><script>
      parent.postMessage({type:"snapshots:slideshow-ready",buildVersion:"synthetic-update"},location.origin);
    </script></body></html>`,
    });
  });
  await page.getByRole("button", { name: "Slideshow diagnostics" }).click();
  await diagnostics.getByRole("button", { name: "Check for code update" }).click();
  await expect(frame).toHaveAttribute("src", /shellVersion=synthetic-update/);
  await expect(frame).toHaveAttribute("data-ready", "false");
  await expect(frame).toHaveCSS("opacity", "0");
  await expect(lastPhoto).toHaveAttribute("src", source!);
  await expect(lastPhoto).toBeVisible();
  await expect(diagnostics).not.toHaveAttribute("data-code-status", "current");
  await page.screenshot({
    path: test.info().outputPath("retained-photo-during-broken-update.png"),
  });

  // Let the real readiness deadline run, without sleeps or pretending a photo
  // has decoded. It must recover even though boot already acknowledged JS.
  const generation = Number(await frame.getAttribute("data-runtime-generation"));
  await expect
    .poll(async () => Number(await frame.getAttribute("data-runtime-generation")), {
      // 20s readiness deadline plus the first 15s retry backoff.
      timeout: 40_000,
    })
    .toBeGreaterThan(generation);
  await expect(lastPhoto).toHaveAttribute("src", source!);

  broken = false;
  advertisedVersion = originalVersion;
  await diagnostics.getByRole("button", { name: "Check for code update" }).click();
  await expect(frame).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await expect(diagnostics).toHaveAttribute("data-code-status", "current");
  expect(
    await page.evaluate(() => (window as Window & { __wakeReleases?: number }).__wakeReleases),
  ).toBe(0);
});

test("wake-lock failure never blocks the embedded slideshow", async ({ page }) => {
  // This case reads the panel's own account of the failure, so it opts into the
  // pill that opens it.
  await page.addInitScript(() => {
    window.localStorage.setItem("slideshow-status-pill", "on");
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => Promise.reject(new Error("wake lock denied")) },
    });
  });

  await gotoHydrated(page, "/slideshow/shell?mode=random&delay=86400");
  const prompt = page.getByRole("button", {
    name: "Keep slideshow awake",
  });
  await expect(prompt).toBeVisible();
  await prompt.click();
  // A refused request remains visible as a small recovery button, not a
  // full-screen interception layer. The diagnostics control must stay usable.
  await expect(prompt).toBeVisible();

  const runtime = page.frameLocator('iframe[title="Slideshow"]');
  await expect(runtime.locator(slideshowImage).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Slideshow diagnostics" }).click();
  await expect(page.getByText("Wake lock off")).toBeVisible();
});

test("slideshow exit controls leave the outer shell", async ({ page }) => {
  await gotoHydrated(page, "/slideshow/shell?mode=random&delay=86400");
  const runtime = page.frameLocator('iframe[title="Slideshow"]');
  await expect(runtime.locator(slideshowImage).first()).toBeVisible({ timeout: 15_000 });
  await runtime.getByRole("link", { name: /Snapshots Slideshow/ }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('iframe[title="Slideshow"]')).toHaveCount(0);
});

test("slideshow context links leave the outer shell", async ({ page }) => {
  // This journey includes the photo-ready shell (up to 20s) followed by a
  // second document navigation; the default 15s budget cannot cover both.
  test.setTimeout(45_000);
  // This case proves the outer-document handoff, not album rendering (covered
  // by smoke.spec.ts). Keep the destination minimal: native video controls in
  // Linux iPad-emulated WebKit can stall even a script-disabled album document.
  await page.route("**/album/test-simple", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Album destination</title><h1>Album destination</h1>",
    }),
  );
  await gotoHydrated(page, updateTestUrl);
  const runtime = page.frameLocator('iframe[title="Slideshow"]');
  await expect(runtime.locator(slideshowImage).first()).toBeVisible({ timeout: 15_000 });

  const arrived = page.waitForURL(/\/album\/test-simple#/, { waitUntil: "domcontentloaded" });
  await runtime.getByRole("link", { name: / in / }).last().click();
  await arrived;
  await expect(page.locator('iframe[title="Slideshow"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Album destination" })).toBeVisible();
});
