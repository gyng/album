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

test("Guess Where keeps the regular nav until play and respects reduced motion when moving it", async ({
  page,
}) => {
  await stubExternalMapAssets(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    // Preserve and explicitly rebind the native method while observing real animation.
    // oxlint-disable-next-line typescript/unbound-method
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.tagName === "NAV") document.documentElement.dataset.navAnimated = "true";
      return original.call(this, frames, options);
    };
  });
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    await gotoHydrated(page, "/fun");
    const ordinary = (await page.getByRole("link", { name: "Albums", exact: true }).boundingBox())!;
    await gotoHydrated(page, "/fun/guess");
    await expect(page.getByRole("button", { name: /^Play/ })).toBeVisible();
    const lobby = (await page.getByRole("link", { name: "Albums", exact: true }).boundingBox())!;
    expect(lobby.x).toBeCloseTo(ordinary.x, 0);
    expect(lobby.y).toBeCloseTo(ordinary.y, 0);
    await page.getByRole("button", { name: /^Play/ }).click();
    await expect(page.getByRole("img", { name: /mystery photo/i })).toBeVisible();
    if (reducedMotion === "reduce")
      await expect(page.locator("html")).not.toHaveAttribute("data-nav-animated", "true");
    else await expect(page.locator("html")).toHaveAttribute("data-nav-animated", "true");
    await expect
      .poll(() =>
        page
          .getByRole("navigation")
          .first()
          .evaluate(
            (node) =>
              node.getAnimations().filter((animation) => animation.playState === "running").length,
          ),
      )
      .toBe(0);
    const playing = (await page.getByRole("link", { name: "Albums", exact: true }).boundingBox())!;
    expect(playing.y).toBeLessThan(lobby.y);
  }
});

test("navigation moves between the map and regular pages in both directions", async ({ page }) => {
  await stubExternalMapAssets(page);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    // Observe the native animation while retaining its real timing and rendering.
    // oxlint-disable-next-line typescript/unbound-method
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.tagName === "NAV")
        document.documentElement.dataset.navAnimatedRoute = location.pathname;
      return original.call(this, frames, options);
    };
  });
  await gotoHydrated(page, "/fun");
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await expect(page).toHaveURL(/\/map/);
  await expect(page.locator("html")).toHaveAttribute("data-nav-animated-route", "/map");
  await page.getByRole("link", { name: "Fun!", exact: true }).click();
  await expect(page).toHaveURL(/\/fun/);
  await expect(page.locator("html")).toHaveAttribute("data-nav-animated-route", "/fun");
});
