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
      if (this.hasAttribute("data-nav-motion-region"))
        document.documentElement.dataset.navAnimated = "true";
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
              node
                .getAnimations({ subtree: true })
                .filter(
                  (animation) =>
                    animation.playState === "running" || animation.playState === "paused",
                ).length,
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
      const animation = original.call(this, frames, options);
      const region = this.getAttribute("data-nav-motion-region");
      if (region) {
        animation.currentTime = 0;
        const matrix = new DOMMatrixReadOnly(String((frames as Keyframe[])[0]?.transform));
        const theme = this.querySelector('select[aria-label="Theme"]')?.getBoundingClientRect();
        const events = JSON.parse(document.documentElement.dataset.navMotions ?? "[]");
        events.push({
          path: location.pathname,
          region,
          dx: matrix.m41,
          theme: theme ? { x: theme.x, y: theme.y, right: theme.right } : null,
        });
        document.documentElement.dataset.navMotions = JSON.stringify(events);
      }
      return animation;
    };
  });
  await gotoHydrated(page, "/fun");
  const themeBefore = (await page
    .locator('[data-nav-motion-region="right"]')
    .getByRole("combobox", { name: "Theme", exact: true })
    .boundingBox())!;
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await page.waitForURL(/\/map/);
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate(
          (node) =>
            JSON.parse(node.dataset.navMotions ?? "[]").filter(
              (event: { path: string }) => event.path === "/map",
            ).length,
        ),
    )
    .toBeGreaterThanOrEqual(2);
  const outward = await page.locator("html").evaluate(
    (node) =>
      JSON.parse(node.dataset.navMotions ?? "[]") as Array<{
        path: string;
        region: string;
        dx: number;
        theme: { x: number; y: number; right: number } | null;
      }>,
  );
  expect(
    outward.find((event) => event.path === "/map" && event.region === "left")!.dx,
  ).toBeGreaterThan(0);
  const movingTheme = outward.find((event) => event.path === "/map" && event.region === "right")!;
  expect(movingTheme.dx).toBeLessThan(0);
  expect(Math.abs(movingTheme.theme!.x - themeBefore.x)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(movingTheme.theme!.right - (themeBefore.x + themeBefore.width)),
  ).toBeLessThanOrEqual(1);
  await expect
    .poll(() =>
      page
        .locator('[data-nav-motion-region="right"]')
        .evaluate(
          (node) =>
            node
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" || animation.playState === "paused",
              ).length,
        ),
    )
    .toBe(0);
  const mapTheme = (await page
    .locator('[data-nav-motion-region="right"]')
    .getByRole("combobox", { name: "Theme", exact: true })
    .filter({ visible: true })
    .boundingBox())!;
  await page.goBack();
  await page.waitForURL(/\/fun/);
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate(
          (node) =>
            JSON.parse(node.dataset.navMotions ?? "[]").filter(
              (event: { path: string }) => event.path === "/fun",
            ).length,
        ),
    )
    .toBeGreaterThanOrEqual(2);
  const inward = await page.locator("html").evaluate(
    (node) =>
      JSON.parse(node.dataset.navMotions ?? "[]") as Array<{
        path: string;
        region: string;
        dx: number;
        theme: { x: number; y: number; right: number } | null;
      }>,
  );
  expect(inward.find((event) => event.path === "/fun" && event.region === "left")!.dx).toBeLessThan(
    0,
  );
  const returningTheme = inward.find((event) => event.path === "/fun" && event.region === "right")!;
  expect(returningTheme.dx).toBeGreaterThan(0);
  expect(Math.abs(returningTheme.theme!.x - mapTheme.x)).toBeLessThanOrEqual(1);
  await page.goForward();
  await page.waitForURL(/\/map/);
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate(
          (node) =>
            JSON.parse(node.dataset.navMotions ?? "[]").filter(
              (event: { path: string }) => event.path === "/map",
            ).length,
        ),
    )
    .toBeGreaterThanOrEqual(4);
});
