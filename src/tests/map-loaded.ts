import { expect, type Locator, type Page } from "@playwright/test";

/*
 * A dead map is invisible to the obvious assertions.
 *
 * `new gl.Map(...)` synchronously appends a `<canvas>` and sizes its container,
 * so "a canvas is visible" is true even when MapLibre's tile worker never boots
 * and the map paints nothing and requests no tile. The same goes for the page
 * chrome around a map, and for the app's own container div that happens to
 * carry the map's `role="region"` label.
 *
 * Children are NOT a liveness signal, deliberately. The port mounts them as
 * soon as the map object exists, so a failed style, a blocked key or a dead
 * worker degrades to "controls over a blank basemap" rather than deleting the
 * entire map UI. That is the right product behaviour — and it means the
 * presence of a child, whether a control or the children wrapper, proves only
 * that a `Map` was constructed.
 *
 * The honest signal is the status the port publishes on its container:
 * `data-map-status` reaches `"loaded"` only once MapLibre fires `load`, which
 * needs the style document *and* the first viewport's tiles.
 */

/** Statuses the map port publishes on its container element. */
export type MapStatus = "initialising" | "ready" | "loaded" | "unavailable";

/**
 * The map container once MapLibre has genuinely loaded — style fetched, first
 * tiles produced. Fails on a dead tile worker, a 404 style or a rejected API
 * key, each of which still leaves a canvas and mounted children behind.
 */
export const loadedMap = (scope: Page | Locator): Locator =>
  scope.locator('[data-map-status="loaded"]').first();

/** The map container in any state, for asserting a particular status. */
export const mapContainer = (scope: Page | Locator): Locator =>
  scope.locator("[data-map-status]").first();

/**
 * A navigation control's zoom-in button. Proves a map instance exists and that
 * `addControl` attached to it, but NOT that the map loaded — controls mount
 * pre-load by design. Pair it with `expectMapLoaded` when liveness is the point.
 */
export const mapZoomInControl = (scope: Page | Locator): Locator =>
  scope.getByRole("button", { name: "Zoom in" }).first();

/** Asserts the map behind `scope` really loaded its style and tiles. */
export const expectMapLoaded = async (scope: Page | Locator): Promise<void> => {
  await expect(loadedMap(scope)).toBeAttached();
};
