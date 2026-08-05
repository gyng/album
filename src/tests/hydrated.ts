import type { Page } from "@playwright/test";

/**
 * Waits until the application has taken over its own markup.
 *
 * Server-rendered HTML looks interactive long before React attaches to it, and
 * a control driven in that window takes a value hydration then throws away —
 * which surfaces as a logic bug rather than a race. The theme picker failed
 * exactly this way under a busy suite: asked for "slate", reported "dark".
 *
 * `AppRuntime` sets `data-app-hydrated` on the root in a mount effect, so this
 * is the application's own word for "I am live", not a guess about timing.
 */
export const waitForHydration = (page: Page): Promise<void> =>
  page.locator("html[data-app-hydrated]").waitFor({ state: "attached", timeout: 15_000 });

/**
 * Navigate, then wait for the application to be live.
 *
 * Use this in any spec that drives a control rather than only reading the page.
 * It costs nothing once hydrated, and it removes the whole class of flake where
 * a fast machine passes and a loaded one does not.
 */
export const gotoHydrated = async (page: Page, url: string): Promise<void> => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
};
