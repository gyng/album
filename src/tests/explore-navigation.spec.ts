import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

test("Explore groups archive views and preserves filtered timeline links", async ({ page }) => {
  await gotoHydrated(page, "/explore");
  const subnav = page.getByRole("navigation", { name: "Explore views" });
  await expect(subnav.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await subnav.getByRole("link", { name: "Timeline" }).click();
  await expect(page).toHaveURL(/\/explore\/timeline$/);
  await expect(subnav.getByRole("link", { name: "Timeline" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await gotoHydrated(page, "/timeline?filter_album=test-simple&date=2019-11-06");
  await expect(page).toHaveURL(/\/explore\/timeline\?filter_album=test-simple&date=2019-11-06$/);
  await expect(page.getByRole("heading", { name: "Timeline", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/explore");
  const right = await subnav.evaluate((element) => element.getBoundingClientRect().right);
  expect(right).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("weather and framing facets survive a reload and constrain search results", async ({
  page,
}) => {
  await gotoHydrated(
    page,
    "/search?facet=weather-condition%3AMostly%20clear&facet=aspect-ratio%3A3%3A2",
  );
  await expect(page.getByRole("button", { name: /Conditions: Mostly clear/ })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("button", { name: /Aspect ratio: 3:2/ })).toBeVisible();
  const results = page.locator("ul[aria-busy]");
  await expect(results).toHaveAttribute("aria-busy", "false");
  await expect(results.locator('a[href="/album/test-simple#DSCF2768.JPG"]')).toBeVisible();
  await expect(results.locator('a[href="/album/test-simple#DSCF2485-2.jpg"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-app-hydrated", "true");
  await expect(page.getByRole("button", { name: /Conditions: Mostly clear/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Aspect ratio: 3:2/ })).toBeVisible();
});

for (const source of ["/", "/album/test-simple"]) {
  for (const width of [390, 1440]) {
    test(`navigation continues its strip between ${source} and Explore at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.addInitScript(() => {
        // oxlint-disable-next-line typescript/unbound-method
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (frames, options) {
          const animation = animate.call(this, frames, options);
          const region = this.getAttribute("data-nav-motion-region");
          if (region) {
            animation.currentTime = 0;
            const rect = this.getBoundingClientRect();
            const starts = JSON.parse(document.documentElement.dataset.navMotionStarts ?? "[]");
            starts.push({
              region,
              x: rect.x,
              y: rect.y,
              right: rect.right,
              at: Date.now(),
              path: location.pathname,
            });
            document.documentElement.dataset.navMotionStarts = JSON.stringify(starts);
          }
          return animation;
        };
        document.addEventListener(
          "click",
          (event) => {
            const link = (event.target as Element).closest('nav a[href="/explore"]');
            if (!link) return;
            const strip = link.closest("ul")!;
            document.documentElement.dataset.outgoingScroll = String(strip.scrollLeft);
          },
          true,
        );
        // oxlint-disable-next-line typescript/unbound-method
        const original = Element.prototype.scrollTo;
        Element.prototype.scrollTo = function (optionsOrX?: ScrollToOptions | number, y?: number) {
          if (this.getAttribute("data-nav-motion-region") === "left") {
            document.documentElement.dataset.stripReveal = JSON.stringify({
              path: location.pathname,
              from: this.scrollLeft,
              behaviour: typeof optionsOrX === "object" ? optionsOrX.behavior : "auto",
            });
          }
          if (typeof optionsOrX === "number") return original.call(this, optionsOrX, y ?? 0);
          return original.bind(this)(optionsOrX);
        };
      });
      await gotoHydrated(page, source);
      const strip = page.locator('[data-nav-motion-region="left"]');
      if (width === 390)
        await strip.evaluate((node) => {
          node.scrollLeft = 100;
        });
      await page
        .getByRole("navigation")
        .first()
        .getByRole("link", { name: "Explore", exact: true })
        .click();
      await expect(page).toHaveURL(/\/explore$/);
      const outgoing = Number(await page.locator("html").getAttribute("data-outgoing-scroll"));
      const reveal = JSON.parse(
        (await page.locator("html").getAttribute("data-strip-reveal")) ?? "null",
      );
      if (reveal?.path === "/explore") {
        expect(Math.abs(reveal.from - outgoing)).toBeLessThanOrEqual(1);
        expect(reveal.behaviour).toBe("smooth");
      } else {
        expect(await strip.evaluate((node) => node.scrollLeft)).toBe(outgoing);
      }
      await expect
        .poll(async () => {
          const bounds = await strip.boundingBox();
          const active = await page
            .getByRole("navigation")
            .first()
            .getByRole("link", { name: "Explore", exact: true })
            .boundingBox();
          return (
            !!bounds &&
            !!active &&
            active.x >= bounds.x - 1 &&
            active.x + active.width <= bounds.x + bounds.width + 1
          );
        })
        .toBe(true);

      for (const direction of ["back", "forward", "back", "forward"] as const) {
        const previousPositions = await page
          .locator("[data-nav-motion-region]")
          .evaluateAll((nodes) =>
            nodes.flatMap((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width && rect.height
                ? [
                    {
                      region: node.getAttribute("data-nav-motion-region")!,
                      x: rect.x,
                      y: rect.y,
                      right: rect.right,
                    },
                  ]
                : [];
            }),
          );
        const startedAt = await page.evaluate(() => Date.now());
        const outgoingScroll = await strip.evaluate((node) => node.scrollLeft);
        await page.locator("html").evaluate((node) => {
          delete node.dataset.stripReveal;
        });
        if (direction === "back") await page.goBack();
        else await page.goForward();
        const destination = direction === "back" ? source : "/explore";
        await expect(page).toHaveURL(new RegExp(`${destination === "/" ? "/" : destination}$`));
        if (destination === "/explore") {
          await expect(page.getByRole("navigation", { name: "Explore views" })).toBeVisible();
        } else if (destination === "/") {
          await expect(
            page.getByRole("navigation").first().getByRole("link", { name: "Albums", exact: true }),
          ).toHaveAttribute("aria-current", "page");
        } else {
          await expect(
            page.getByRole("group", { name: "Album navigation" }).first(),
          ).toBeAttached();
        }
        const restoredReveal = JSON.parse(
          (await page.locator("html").getAttribute("data-strip-reveal")) ?? "null",
        );
        const maxScroll = await strip.evaluate((node) => node.scrollWidth - node.clientWidth);
        const expectedScroll = Math.min(outgoingScroll, maxScroll);
        if (restoredReveal?.path === destination) {
          expect(Math.abs(restoredReveal.from - expectedScroll)).toBeLessThanOrEqual(1);
          expect(restoredReveal.behaviour).toBe("smooth");
        } else {
          expect(
            Math.abs((await strip.evaluate((node) => node.scrollLeft)) - expectedScroll),
          ).toBeLessThanOrEqual(1);
        }
        const activeLink = page.getByRole("navigation").first().locator("[aria-current]");
        if (await activeLink.count()) {
          await expect
            .poll(async () => {
              const bounds = await strip.boundingBox();
              const active = await activeLink.boundingBox();
              return (
                !!bounds &&
                !!active &&
                active.x >= bounds.x - 1 &&
                active.x + active.width <= bounds.x + bounds.width + 1
              );
            })
            .toBe(true);
        }
        await expect
          .poll(() =>
            strip.evaluate(
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
        const settledPositions = await page
          .locator("[data-nav-motion-region]")
          .evaluateAll((nodes) =>
            nodes.flatMap((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width && rect.height
                ? [
                    {
                      region: node.getAttribute("data-nav-motion-region")!,
                      x: rect.x,
                      y: rect.y,
                      right: rect.right,
                    },
                  ]
                : [];
            }),
          );
        const starts: Array<{
          region: string;
          x: number;
          y: number;
          right: number;
          at: number;
          path: string;
        }> = JSON.parse(
          (await page.locator("html").getAttribute("data-nav-motion-starts")) ?? "[]",
        );
        for (const before of previousPositions) {
          const after = settledPositions.find((position) => position.region === before.region);
          if (!after) continue;
          const edge = before.region === "right" ? "right" : "x";
          if (Math.hypot(after[edge] - before[edge], after.y - before.y) <= 1) continue;
          const start = starts.find(
            (position) =>
              position.region === before.region &&
              position.path === destination &&
              position.at >= startedAt,
          );
          expect(
            start,
            `${direction} to ${destination}: ${before.region} should transition`,
          ).toBeDefined();
          expect(Math.abs(start![edge] - before[edge])).toBeLessThanOrEqual(1);
          expect(Math.abs(start!.y - before.y)).toBeLessThanOrEqual(1);
        }
      }
    });
  }
}

test("album to Explore paints intermediate nav positions after expensive mount work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    // Leave the native animation clock untouched: checking only its first
    // keyframe misses a transition whose entire duration passes before paint.
    // oxlint-disable-next-line typescript/unbound-method
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = original.call(this, frames, options);
      if (
        location.pathname === "/explore" &&
        this.getAttribute("data-nav-motion-region") === "left"
      ) {
        requestAnimationFrame(() => {
          // Deterministically model a heavy Explore mount occupying the first frame.
          const until = performance.now() + 250;
          while (performance.now() < until) {
            /* deliberate main-thread load */
          }
          const positions: number[] = [];
          const sample = () => {
            positions.push(this.getBoundingClientRect().y);
            if (positions.length < 25) requestAnimationFrame(sample);
            else document.documentElement.dataset.navPaintPositions = JSON.stringify(positions);
          };
          requestAnimationFrame(sample);
        });
      }
      return animation;
    };
  });
  await gotoHydrated(page, "/album/test-simple");
  const nav = page.locator('[data-nav-motion-region="left"]');
  const before = (await nav.boundingBox())!.y;
  await page
    .getByRole("navigation")
    .first()
    .getByRole("link", { name: "Explore", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-nav-paint-positions", /\[/);
  const positions: number[] = JSON.parse(
    (await page.locator("html").getAttribute("data-nav-paint-positions"))!,
  );
  const after = (await nav.boundingBox())!.y;
  expect(after - before).toBeGreaterThan(10);
  const intermediate = positions.filter((y) => y > before + 2 && y < after - 2);
  expect(
    new Set(intermediate.map((y) => Math.round(y))).size,
    JSON.stringify({ before, after, positions }),
  ).toBeGreaterThanOrEqual(2);
});
