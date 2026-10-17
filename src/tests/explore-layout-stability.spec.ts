import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

/**
 * `/explore` must not move under the reader.
 *
 * Every section on that page used to be mounted when its placeholder came into
 * range, so the server's short page grew by thousands of pixels at hydration:
 * measured CLS 0.2997 at 1280×900, with everything below `#visual-sameness`
 * jumping 3253px. The narrow-viewport collapse is a CSS decision now and the
 * client-only cloud reserves its box, so the first paint is already the final
 * layout where the reader is looking.
 *
 * Two properties, because either alone can be satisfied by accident. The shift
 * budget is what a reader feels; the height rule is what makes it structural —
 * a section that is on screen at paint must not grow afterwards, however small
 * the movement it charges.
 *
 * The budget is deliberately small but not zero: a font swap or a lazy image
 * inside a stat card can move something by a pixel, and a test demanding
 * perfection would be re-tuned until it proved nothing.
 */
const LOAD_CLS_BUDGET = 0.02;

type ShiftReport = { cls: number; count: number; worst: Array<{ value: number; node: string }> };

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

const measureLoadShift = async (page: Page): Promise<ShiftReport> => {
  const shifts: ShiftReport["worst"] = [];
  await page.exposeFunction("__clsShift", (payload: { value: number; hadRecentInput: boolean; node: string }) => {
    if (!payload.hadRecentInput) {
      shifts.push({ value: payload.value, node: payload.node });
    }
  });
  await page.addInitScript(() => {
    // Playwright's exposeFunction installs this on the page; the page cannot
    // tell the compiler that, so it is read once into a named const.
    const report = (window as unknown as { __clsShift?: (p: { value: number; hadRecentInput: boolean; node: string }) => void }).__clsShift;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: Array<{ node?: Node | null }>;
        };
        const source = shift.sources?.[0]?.node;
        const element = source instanceof Element ? source : null;
        const section = element?.closest("section[id]");
        report?.({
          value: shift.value,
          hadRecentInput: shift.hadRecentInput,
          node: element
            ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${section ? ` in #${section.id}` : ""}`
            : "unknown",
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  await gotoHydrated(page, "/explore");
  await page.waitForTimeout(2500);
  return {
    cls: Number(shifts.reduce((sum, entry) => sum + entry.value, 0).toFixed(4)),
    count: shifts.length,
    worst: shifts.slice().sort((a, b) => b.value - a.value).slice(0, 3),
  };
};

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

    const report = await measureLoadShift(page);
    expect(report.cls, `layout shift while loading: ${JSON.stringify(report.worst)}`).toBeLessThanOrEqual(
      LOAD_CLS_BUDGET,
    );
  });
}
