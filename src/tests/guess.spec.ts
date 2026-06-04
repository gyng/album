import { test, expect } from "@playwright/test";
import { existsSync, statSync } from "fs";
import { join } from "path";

const searchDbPath = join(__dirname, "..", "public", "search.sqlite");
const hasSearchDb =
  existsSync(searchDbPath) && statSync(searchDbPath).size > 0;

test.describe("guess game layout", () => {
  test.skip(!hasSearchDb, "Requires search.sqlite with data");

  // Regression: a portrait photo's `height: 100%` used to fall back to its
  // intrinsic aspect ratio because `.page` was `min-height` (an indefinite
  // height), so the photo — and the map dragged along with it — overflowed the
  // viewport vertically by a lot. A short, wide viewport makes the broken
  // height chain overflow for any photo (portrait, or even a 3:2 landscape), so
  // this catches the regression regardless of which photo the local DB serves.
  test("round fits the viewport — photo and map do not overflow vertically", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    await page.goto("/guess?seed=layout-regression&rounds=1");

    // The overflow only manifests once the <img> has real intrinsic
    // dimensions. If the resized image is unavailable (e.g. running against a
    // dev server that has not generated it), skip rather than fail spuriously.
    const photoLoaded = await page
      .waitForFunction(() => {
        const img = document.querySelector(
          '[class*="photoPanel"] img',
        ) as HTMLImageElement | null;
        return !!img && img.complete && img.naturalWidth > 0;
      })
      .then(() => true)
      .catch(() => false);

    test.skip(
      !photoLoaded,
      "Round photo did not load (resized images not built) — skipping layout assertion",
    );

    const metrics = await page.evaluate(() => {
      const vh = window.innerHeight;
      const pick = (sub: string) =>
        document.querySelector(`[class*="${sub}"]`);
      const bottom = (el: Element | null) =>
        el ? Math.round(el.getBoundingClientRect().bottom) : 0;
      return {
        vh,
        docScrollHeight: document.documentElement.scrollHeight,
        photoPanelBottom: bottom(pick("photoPanel")),
        mapBottom: bottom(pick("mapContainer")),
      };
    });

    // The document must not scroll vertically, and neither the photo panel nor
    // the map may extend past the bottom of the viewport.
    expect(metrics.docScrollHeight).toBeLessThanOrEqual(metrics.vh + 1);
    expect(metrics.photoPanelBottom).toBeLessThanOrEqual(metrics.vh + 1);
    expect(metrics.mapBottom).toBeLessThanOrEqual(metrics.vh + 1);
  });
});
