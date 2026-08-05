import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { expectMapLoaded } from "./map-loaded";
import { stubExternalMapAssets } from "./map-network";

test.describe("guess game layout", () => {
  // Regression: a portrait photo's `height: 100%` used to fall back to its
  // intrinsic aspect ratio because `.page` was `min-height` (an indefinite
  // height), so the photo — and the map dragged along with it — overflowed the
  // viewport vertically by a lot. A short, wide viewport makes the broken
  // height chain overflow for any photo (portrait, or even a 3:2 landscape), so
  // this catches the regression regardless of which photo the local DB serves.
  test("round fits the viewport — photo and map do not overflow vertically", async ({ page }) => {
    await stubExternalMapAssets(page);
    await page.setViewportSize({ width: 1280, height: 520 });
    await gotoHydrated(page, "/guess?seed=layout-regression&rounds=1");

    // The overflow only manifests once the image has real intrinsic dimensions.
    // Missing generated media is a fixture failure, not a reason to skip coverage.
    const photoPanel = page.getByRole("img", { name: /mystery photo/i });
    const map = page.getByRole("region", { name: "Guess map" });
    await expect(photoPanel).toBeVisible();
    await expect(map).toBeVisible();
    // `map` is the app's own labelled container, which is laid out whether or
    // not the map inside it ever loaded. The round is only really playable once
    // the map has mounted its children, so measure that too — the layout this
    // test guards is the layout of a working map.
    await expectMapLoaded(map);

    const photo = photoPanel.locator("img");
    await expect(photo).toBeVisible();
    await expect
      .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);

    const [photoPanelBox, mapBox, metrics] = await Promise.all([
      photoPanel.boundingBox(),
      map.boundingBox(),
      page.evaluate(() => ({
        vh: window.innerHeight,
        docScrollHeight: document.documentElement.scrollHeight,
      })),
    ]);

    expect(photoPanelBox).not.toBeNull();
    expect(mapBox).not.toBeNull();
    if (!photoPanelBox || !mapBox) {
      throw new Error("Guess round regions have no layout boxes");
    }

    // The document must not scroll vertically, and neither the photo panel nor
    // the map may extend past the bottom of the viewport.
    expect(metrics.docScrollHeight).toBeLessThanOrEqual(metrics.vh + 1);
    expect(Math.round(photoPanelBox.y + photoPanelBox.height)).toBeLessThanOrEqual(metrics.vh + 1);
    expect(Math.round(mapBox.y + mapBox.height)).toBeLessThanOrEqual(metrics.vh + 1);
  });
});
