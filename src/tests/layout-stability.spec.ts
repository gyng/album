import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

/**
 * `/explore` and `/search` must not move under the reader.
 *
 * `/explore` used to mount every section when its placeholder came into range,
 * so the server's short page grew by thousands of pixels at hydration: measured
 * CLS 0.2997 at 1280×900, with everything below `#visual-sameness` jumping
 * 3253px. Every group now renders its content in the server HTML at every width
 * and the client-only cloud reserves its box, so the first paint is already the
 * final layout.
 *
 * `/search` is client-rendered, so its rule is the shift budget alone: the
 * widget's box is reserved before it arrives, each browse grid holds its first
 * page with placeholder tiles, "Random selection" waits for the memories that
 * land above it, and the random grid extends a viewport ahead of the reader.
 * Before that it measured 0.14 at 1280×900 and 0.32 at 390×844 while loading.
 *
 * The budget is deliberately small but not zero: a font swap or a lazy image
 * inside a stat card can move something by a pixel, and a test demanding
 * perfection would be re-tuned until it proved nothing.
 */
const LOAD_CLS_BUDGET = 0.02;

type ShiftReport = { cls: number; worst: Array<{ value: number; node: string }> };

const visibleSectionHeights = async (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => {
    const heights: Record<string, number> = {};
    for (const section of document.querySelectorAll("main section[id]")) {
      const rect = section.getBoundingClientRect();
      // Only what the reader can actually see: a section far below the fold is
      // allowed to settle as its images arrive without moving anything on
      // screen, and demanding otherwise would pin lazy loading itself.
      if (rect.top < window.innerHeight) {
        heights[section.id] = Math.round(rect.height);
      }
    }
    return heights;
  });

/** Collects every layout shift not caused by input, from navigation onwards. */
const recordShifts = async (page: Page) => {
  const shifts: ShiftReport["worst"] = [];
  await page.exposeFunction(
    "__clsShift",
    (payload: { value: number; hadRecentInput: boolean; node: string }) => {
      if (!payload.hadRecentInput) {
        shifts.push({ value: payload.value, node: payload.node });
      }
    },
  );
  await page.addInitScript(() => {
    // Playwright's exposeFunction installs this on the page; the page cannot
    // tell the compiler that, so it is read once into a named const.
    const report = (
      window as unknown as {
        __clsShift?: (p: { value: number; hadRecentInput: boolean; node: string }) => void;
      }
    ).__clsShift;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: Array<{ node?: Node | null }>;
        };
        const source = shift.sources?.[0]?.node;
        const element = source instanceof Element ? source : null;
        const section = element?.closest("section[id], section[aria-label]");
        const sectionName = section?.id ? `#${section.id}` : section?.getAttribute("aria-label");
        report?.({
          value: shift.value,
          hadRecentInput: shift.hadRecentInput,
          node: element
            ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${sectionName ? ` in ${sectionName}` : ""}`
            : "unknown",
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  return (): ShiftReport => ({
    cls: Number(shifts.reduce((sum, entry) => sum + entry.value, 0).toFixed(4)),
    worst: shifts
      .slice()
      .sort((a, b) => b.value - a.value)
      .slice(0, 3),
  });
};

const expectWithinBudget = (report: ShiftReport, phase: string) =>
  expect(report.cls, `layout shift ${phase}: ${JSON.stringify(report.worst)}`).toBeLessThanOrEqual(
    LOAD_CLS_BUDGET,
  );

for (const [label, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`explore does not shift while it loads — ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);

    await page.goto("/explore", { waitUntil: "load" });
    const atFirstPaint = await visibleSectionHeights(page);
    expect(Object.keys(atFirstPaint).length).toBeGreaterThan(0);
    await page.waitForTimeout(2500);
    expect(await visibleSectionHeights(page)).toEqual(atFirstPaint);

    const report = await recordShifts(page);
    await gotoHydrated(page, "/explore");
    await page.waitForTimeout(2500);
    expectWithinBudget(report(), "while loading");
  });

  test(`search does not shift while it loads — ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const report = await recordShifts(page);

    await gotoHydrated(page, "/search");
    // The browse grids are filled from the in-browser database; once the
    // random grid has rows, everything the opening screen loads has landed.
    await expect(
      page.getByRole("region", { name: "Explore browse mode" }).getByRole("link").first(),
    ).toBeVisible();
    await page.waitForTimeout(1500);
    expectWithinBudget(report(), "while loading");
  });
}
