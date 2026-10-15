import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { expectMapLoaded } from "./map-loaded";

test.use({ deviceScaleFactor: 2, serviceWorkers: "block" });
test("retina maps load the gallery sprite index and image", async ({ page }) => {
  await page.route(
    (url) => /^\/map-styles\/[^/]+\.json$/.test(url.pathname),
    (route) => {
      const origin = new URL(route.request().url()).origin;
      return route.fulfill({
        json: {
          version: 8,
          sprite: `${origin}/map-styles/gallery/sprite`,
          sources: {
            fixture: {
              type: "geojson",
              data: {
                type: "FeatureCollection",
                features: [
                  {
                    type: "Feature",
                    properties: {},
                    geometry: { type: "Point", coordinates: [0, 0] },
                  },
                ],
              },
            },
          },
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#eeeeee" } },
            {
              id: "symbols",
              type: "symbol",
              source: "fixture",
              layout: { "icon-image": "circle" },
            },
          ],
        },
      });
    },
  );
  const index = page.waitForResponse((response) =>
    response.url().endsWith("/map-styles/gallery/sprite@2x.json"),
  );
  const image = page.waitForResponse((response) =>
    response.url().endsWith("/map-styles/gallery/sprite@2x.png"),
  );
  await gotoHydrated(page, "/map");
  expect((await index).status()).toBe(200);
  expect((await image).status()).toBe(200);
  await expectMapLoaded(page);
});
