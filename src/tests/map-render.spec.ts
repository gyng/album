import { expect, test } from "@playwright/test";
import { expectMapLoaded } from "./map-loaded";
import { stubVectorTileMapAssets } from "./map-network";

/*
 * A map can mount, size itself and hand out a WebGL canvas while rendering
 * absolutely nothing: MapLibre requests and parses tiles in a web worker, so if
 * the worker never boots — as happened when the production bundle resolved its
 * worker URL to an empty string, and the browser dutifully loaded the page
 * itself as the worker — no tile is ever requested, `load` never fires, and no
 * marker, layer or popup mounts. Nothing throws.
 *
 * `stubExternalMapAssets` now serves a source-bearing style everywhere, so the
 * map specs are no longer blind to this. This spec is the explicit statement of
 * the contract, over HTTP rather than an inline source: the map must really ask
 * for tiles, and must really finish loading them.
 */
test.describe("Map tile rendering", () => {
  test("fetches vector tiles and mounts its children", async ({ page }) => {
    const tiles = await stubVectorTileMapAssets(page);

    await page.goto("/map", { waitUntil: "domcontentloaded" });

    // A visible canvas only means MapLibre got a GL context. A tile request
    // means its worker is alive and doing the work the map exists to do.
    await expect
      .poll(() => tiles.requestedTileCount(), {
        message: "the map requested no vector tile — its tile worker never ran",
      })
      .toBeGreaterThan(0);

    // The adapter mounts controls before the style and tiles finish loading.
    // Their presence alone does not prove the tile worker rendered the map.
    await expectMapLoaded(page);
  });
});
