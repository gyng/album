import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "fr-FR", timezoneId: "America/New_York" });

const routes = [
  "/?theme=bling",
  "/album/test-simple#DSCF0506-2.jpg",
  "/benchmark",
  "/design",
  "/explore",
  "/guess?seed=shared-challenge&rounds=3&timer=15",
  "/map?filter_album=test-simple&from=2019-11-01&to=2019-11-30",
  "/search",
  "/slideshow?mode=random&delay=60000",
  "/slideshow/shell",
  "/timeline?filter_album=test-simple&date=2019-11-06",
  "/404",
] as const;

/**
 * `/search` starts downloading the SigLIP text model from Hugging Face's CDN as
 * soon as it mounts, which is several megabytes over the public internet. That
 * keeps the page from ever reaching `networkidle`, so this spec's hydration
 * wait times out on a slow link while passing on a fast one — a real
 * flake whose outcome depends on bandwidth rather than on the code.
 *
 * Aborted rather than held open (the approach in search-image.spec.ts, which
 * asserts a pending state and wants the request to hang): here the network must
 * genuinely fall idle. A failed model fetch raises no hydration diagnostic, and
 * hydration finishes long before any embedding work would begin.
 */
const blockModelDownloads = async (page: Page) => {
  await page.route(
    (url) => /huggingface\.co|hf\.co|jsdelivr\.net/.test(url.href),
    (route) => route.abort(),
  );
};

const isHydrationDiagnostic = (message: string) =>
  /hydration|server rendered html|did not match|minified react error #(41[89]|42[0-5])|cannot be (?:a descendant|a child) of/i.test(
    message,
  );

/**
 * `waitUntil: "load"` plus a couple of animation frames doesn't guarantee React has
 * finished hydrating — Concurrent Mode time-slices hydration work across idle
 * callbacks, and lazily-loaded client chunks (`*Deferred` components) can still be
 * in flight. Rather than a single arbitrary sleep, poll until the diagnostics
 * collected so far have stopped changing for a short quiet window, bounded by an
 * overall deadline so a genuinely broken route still fails fast.
 */
const waitForHydrationSettled = async (
  page: Page,
  diagnostics: string[],
  { quietMs = 300, maxWaitMs = 5000, pollIntervalMs = 50 } = {},
) => {
  await page.waitForLoadState("networkidle");

  const deadline = Date.now() + maxWaitMs;
  let lastCount = diagnostics.length;
  let lastChangeAt = Date.now();

  while (Date.now() < deadline) {
    if (Date.now() - lastChangeAt >= quietMs) {
      return;
    }
    await page.waitForTimeout(pollIntervalMs);
    if (diagnostics.length !== lastCount) {
      lastCount = diagnostics.length;
      lastChangeAt = Date.now();
    }
  }
};

test.describe("server hydration", () => {
  for (const route of routes) {
    test(`${route} hydrates without recovering client content`, async ({ page }) => {
      await blockModelDownloads(page);

      const diagnostics: string[] = [];
      page.on("console", (message) => {
        if (isHydrationDiagnostic(message.text())) {
          diagnostics.push(message.text());
        }
      });
      page.on("pageerror", (error) => {
        if (isHydrationDiagnostic(error.message)) {
          diagnostics.push(error.message);
        }
      });

      await page.addInitScript(() => {
        localStorage.setItem("slideshow-showclock", "true");
        localStorage.setItem("slideshow-showdetails", "true");
        localStorage.setItem("slideshow-mode", '"random"');
        localStorage.setItem("slideshow-timedelay", "60000");
      });

      await page.goto(route, { waitUntil: "load" });
      await page.locator("body").waitFor();
      await waitForHydrationSettled(page, diagnostics);

      expect(diagnostics).toEqual([]);
    });
  }
});
