import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { stubExternalMapAssets } from "./map-network";

// The fixture albums share this GPS fix, giving us overlapping real markers.
const MAP_URL = "/map?lat=36.5788583333333&lon=137.5959733333333&zoom=14";

const overlap = async (marker: Locator, target: Locator) => {
  const box = (await target.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await marker.evaluate((element, at) => {
    const box = element.getBoundingClientRect();
    element.style.translate = `${at.x - box.x - box.width / 2}px ${at.y - box.y - box.height / 2}px`;
    // A large photo catalogue or projected depth must not escape its layer.
    element.style.zIndex = "100000";
  }, point);
  return point;
};

const hitBelongsTo = (target: Locator, point: { x: number; y: number }) =>
  target.evaluate((element, at) => element.contains(document.elementFromPoint(at.x, at.y)), point);

const prepare = async (page: Page) => {
  await stubExternalMapAssets(page);
  await gotoHydrated(page, MAP_URL);
  await expect(page.locator('[data-map-status="loaded"]')).toBeVisible();
  await expect(page.locator(".maplibregl-marker [data-map-pin]").first()).toBeAttached();
};

test("map controls and the legend stay above overlapping photo markers", async ({ page }) => {
  await prepare(page);
  const marker = page.locator(".maplibregl-marker").first();
  for (const target of [
    page.getByRole("button", { name: "Zoom in", exact: true }),
    page.locator(".maplibregl-ctrl-attrib-button"),
    page.locator('[data-map-legend="recency"]'),
  ]) {
    const point = await overlap(marker, target);
    // The legend is intentionally click-through. Temporarily enable hit testing
    // solely to observe its paint order, then restore its normal behaviour.
    const pointerEvents = await target.evaluate((element) => {
      const previous = element.style.pointerEvents;
      element.style.pointerEvents = "auto";
      return previous;
    });
    try {
      expect(await hitBelongsTo(target, point)).toBe(true);
    } finally {
      await target.evaluate((element, previous) => {
        element.style.pointerEvents = previous;
      }, pointerEvents);
      await marker.evaluate((element) => element.style.removeProperty("translate"));
    }
  }
  await expect(page.locator('[data-map-legend="recency"]')).toHaveCSS("pointer-events", "none");
});

test("hover lifts a photo above higher-ranked neighbouring markers", async ({ page }) => {
  await prepare(page);
  // Give one marker clear space to receive a genuine hover, independently of
  // the fixture photos sharing a location. The rank remains application-owned.
  const marker = page.locator(".maplibregl-marker").first();
  await marker.evaluate((element) => {
    const box = element.getBoundingClientRect();
    element.style.translate = `${200 - box.x}px ${200 - box.y}px`;
  });
  await marker.hover();
  await expect
    .poll(() =>
      marker.evaluate((element) => {
        const hovered = Number(getComputedStyle(element).zIndex);
        const others = [...document.querySelectorAll(".maplibregl-marker")]
          .filter((other) => other !== element)
          .map((other) => Number(getComputedStyle(other).zIndex));
        return (
          element.matches(":hover") && others.length > 0 && others.every((rank) => hovered > rank)
        );
      }),
    )
    .toBe(true);
});

test("hover photo previews paint above route overlays", async ({ page }) => {
  await prepare(page);
  const marker = page.locator(".maplibregl-marker").first();
  await marker.evaluate((element) => {
    const box = element.getBoundingClientRect();
    element.style.translate = `${200 - box.x}px ${200 - box.y}px`;
  });
  await marker.hover();
  const popup = page.locator(".maplibregl-popup-content");
  const route = page.locator('svg[class*="routeOverlay"]');
  await expect(popup).toBeVisible();
  await expect(route).toBeAttached();
  const box = (await popup.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Add a tiny hit-test probe to the real SVG layer at the popup's centre.
  // It makes route paint order observable without depending on path geometry.
  await route.evaluate((element, at) => {
    const box = element.getBoundingClientRect();
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    probe.setAttribute("x", String(at.x - box.x - 1));
    probe.setAttribute("y", String(at.y - box.y - 1));
    probe.setAttribute("width", "2");
    probe.setAttribute("height", "2");
    probe.style.pointerEvents = "all";
    element.append(probe);
  }, point);
  await popup.evaluate((element) => {
    element.style.pointerEvents = "auto";
  });
  expect(await hitBelongsTo(popup, point)).toBe(true);
});
