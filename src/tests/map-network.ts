import type { Page } from "@playwright/test";

const MAP_HOSTS = new Set(["tiles.openfreemap.org", "vector.openstreetmap.org"]);

/** The slice of the style spec these stubs serve. */
type StyleDocument = {
  version: number;
  sources: Record<string, Record<string, unknown>>;
  layers: Record<string, unknown>[];
};

/*
 * Map specs serve their own style instead of downloading a third-party one, but
 * that style must still contain a real source.
 *
 * MapLibre does its source and tile work in a web worker, and only fires `load`
 * — the event that mounts the map's React children — once every source has
 * produced its tiles. A style with no sources has nothing to wait for, so `load`
 * fires even when the tile worker is dead. That is exactly how a production
 * build once shipped a map that requested no tile, painted nothing and mounted
 * no marker, with this whole suite green (see
 * `components/map/adapters/maplibre/worker.ts` for the underlying failure).
 *
 * The default source is inline GeoJSON: the worker still has to receive it, tile
 * it and answer before `load` can fire, so a dead worker is fatal — and nothing
 * leaves the browser, which keeps the stub deterministic in every browser,
 * including the Firefox and WebKit smoke runs in CI.
 */
const LOCAL_MAP_STYLE: StyleDocument = {
  version: 8,
  sources: {
    fixture: {
      type: "geojson",
      // Every real style names its data, and the compact attribution collapses
      // to its (i) only when there is something to attribute — without this the
      // control renders empty and MapLibre hides it, so anything asserted about
      // that button would be asserted about a box with no layout.
      attribution: "Fixture data",
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
    { id: "fixture-background", type: "background", paint: { "background-color": "#f2efe9" } },
    {
      id: "fixture-points",
      type: "circle",
      source: "fixture",
      paint: { "circle-radius": 6, "circle-color": "#b03a2e" },
    },
  ],
};

/** Path prefix owned by the tile fixture — the application never serves it. */
const FIXTURE_TILE_PATH = "/__e2e-map-tiles/";

/**
 * A hand-encoded 26-byte Mapbox Vector Tile: one layer, `points`, holding a
 * single point feature at the centre of the tile. Small enough to inline, and
 * real enough that MapLibre's worker has to parse it like any other tile.
 */
const FIXTURE_TILE = Buffer.from("GhgKBnBvaW50cxIJGAEiBQmAIIAgKIAgeAI=", "base64");

const VECTOR_TILE_MAP_STYLE: StyleDocument = {
  version: 8,
  sources: {
    fixture: {
      type: "vector",
      // Root-relative, so the tiles are served by the test origin rather than a
      // CDN whose availability CI would then depend on.
      tiles: [`${FIXTURE_TILE_PATH}{z}/{x}/{y}.pbf`],
      minzoom: 0,
      maxzoom: 0,
    },
  },
  layers: [
    { id: "fixture-background", type: "background", paint: { "background-color": "#f2efe9" } },
    {
      id: "fixture-points",
      type: "circle",
      source: "fixture",
      "source-layer": "points",
      paint: { "circle-radius": 6, "circle-color": "#b03a2e" },
    },
  ],
};

/** Where this site serves its own style documents from. */
const OWN_STYLE_PATH = "/map-styles/";

/**
 * Serve `style` for every style request, third-party or our own, and refuse the
 * rest.
 *
 * Our own documents have to be stubbed too: most basemaps here are served from
 * this origin now, and the real ones point at a tile host the browser is not
 * allowed to reach in a test — which reads exactly like a dead tile worker.
 */
const serveMapStyle = async (page: Page, style: StyleDocument): Promise<void> => {
  await page.route(
    (url) => MAP_HOSTS.has(url.hostname) || url.pathname.startsWith(OWN_STYLE_PATH),
    async (route) => {
      const url = route.request().url();
      if (url.includes("style") || url.includes("/maps/") || url.includes(OWN_STYLE_PATH)) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(style),
        });
        return;
      }

      await route.abort();
    },
  );
};

/**
 * Keep map UI tests deterministic without downloading third-party styles or
 * tiles, while still exercising MapLibre's worker (see `LOCAL_MAP_STYLE`).
 */
export const stubExternalMapAssets = async (page: Page): Promise<void> => {
  await serveMapStyle(page, LOCAL_MAP_STYLE);
};

export type VectorTileStub = {
  /** How many tile requests the browser has actually issued so far. */
  requestedTileCount: () => number;
};

/**
 * Like `stubExternalMapAssets`, but backed by a vector tile source served over
 * HTTP from the test origin, so the whole tile path — worker boot, tile fetch,
 * protobuf parse — has to work for the map to finish loading.
 */
export const stubVectorTileMapAssets = async (page: Page): Promise<VectorTileStub> => {
  let requestedTileCount = 0;

  await page.route(`**${FIXTURE_TILE_PATH}**`, async (route) => {
    requestedTileCount += 1;
    await route.fulfill({
      contentType: "application/x-protobuf",
      body: FIXTURE_TILE,
    });
  });
  await serveMapStyle(page, VECTOR_TILE_MAP_STYLE);

  return { requestedTileCount: () => requestedTileCount };
};
