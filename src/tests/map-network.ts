import type { Page } from "@playwright/test";

const MAP_HOSTS = new Set([
  "api.maptiler.com",
  "tiles.openfreemap.org",
  "vector.openstreetmap.org",
]);

const EMPTY_MAP_STYLE = {
  version: 8,
  sources: {},
  layers: [],
};

/** Keep map UI tests deterministic without downloading third-party styles or tiles. */
export const stubExternalMapAssets = async (page: Page): Promise<void> => {
  await page.route(
    (url) => MAP_HOSTS.has(url.hostname),
    async (route) => {
      const url = route.request().url();
      if (url.includes("style") || url.includes("/maps/")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(EMPTY_MAP_STYLE),
        });
        return;
      }

      await route.abort();
    },
  );
};
