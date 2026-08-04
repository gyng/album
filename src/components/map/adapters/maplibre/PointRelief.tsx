import React from "react";
import {
  encodeTerrarium,
  type ReliefOptions,
  type ReliefPoint,
  RELIEF_TILE_SIZE,
  reliefTileHeights,
} from "../../../../util/pointRelief";
import { gl } from "./engine";
import { useAttachedMap } from "./context";
import { isStyleUsable, useGeneratedId } from "./internal";

/**
 * Terrain out of points, for a renderer that only knows how to read elevation
 * tiles from a URL.
 *
 * MapLibre asks a protocol handler for tiles the way it would ask a server, so
 * the whole landscape is answered from memory: `pointRelief` decides the
 * heights, this encodes them as an image, and the renderer never learns that
 * there is no elevation dataset anywhere.
 *
 * Everything in here is the wiring. The shape of the land is in
 * `util/pointRelief.ts`, where it is tested without a GPU.
 */

export type PointReliefProps = {
  points: readonly ReliefPoint[];
  /** How much the terrain is stretched vertically. 1 is life size, which is invisible. */
  exaggeration?: number;
  /** Beyond this zoom the renderer stops asking for finer tiles. */
  maxzoom?: number;
} & ReliefOptions;

const PROTOCOL = "point-relief";

/**
 * The points every relief source draws from, keyed by source id.
 *
 * A protocol handler is registered globally against a scheme, not against a
 * component, so the tile request has to find its own points: the source id
 * travels in the URL's host and this is where it is looked up.
 */
const fields = new Map<string, { points: readonly ReliefPoint[]; options: ReliefOptions }>();

const TILE_URL = /^point-relief:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/;

/**
 * The first label layer, so the shading goes under the writing rather than over
 * it. Undefined is a valid answer — a basemap with no labels takes it on top.
 */
const firstSymbolLayer = (map: {
  getStyle: () => { layers?: { id: string; type: string }[] } | undefined;
}): string | undefined => map.getStyle()?.layers?.find((layer) => layer.type === "symbol")?.id;

/**
 * Pixels to the thing the renderer wants back.
 *
 * An `ImageBitmap` rather than an encoded PNG: `OffscreenCanvas.convertToBlob`
 * simply never settles while the map is rendering, so every tile stayed
 * outstanding, the map never reached `load`, and nothing anywhere reported an
 * error. `createImageBitmap` costs no encode and no decode either way.
 */
const toTileImage = (pixels: Uint8ClampedArray, size: number): Promise<ImageBitmap> =>
  // `ImageData` insists on a buffer it knows is not shared; the pixels are a
  // fresh array either way.
  createImageBitmap(new ImageData(pixels as ImageDataArray, size, size));

/** One tile, rendered from whatever points its source was given. */
export const reliefTileResponse = async (url: string): Promise<{ data: ImageBitmap }> => {
  const match = TILE_URL.exec(url);
  if (!match) throw new Error(`Not a relief tile: ${url}`);

  const field = fields.get(match[1] ?? "");
  const heights = reliefTileHeights(
    { z: Number(match[2]), x: Number(match[3]), y: Number(match[4]) },
    field?.points ?? [],
    field?.options ?? {},
  );

  return { data: await toTileImage(encodeTerrarium(heights, RELIEF_TILE_SIZE), RELIEF_TILE_SIZE) };
};

let registrations = 0;

const registerProtocol = (): (() => void) => {
  if (registrations === 0) {
    gl.addProtocol(PROTOCOL, (request) => reliefTileResponse(request.url));
  }
  registrations += 1;

  return () => {
    registrations -= 1;
    if (registrations === 0) {
      gl.removeProtocol(PROTOCOL);
    }
  };
};

export const PointRelief: React.FC<PointReliefProps & { id?: string }> = ({
  id,
  points,
  exaggeration = 1.4,
  maxzoom = 14,
  radiusMetres,
  peakMetres,
  ceilingMetres,
}) => {
  const map = useAttachedMap();
  const sourceId = useGeneratedId("relief", id);

  // The points live outside React's tree because a tile request arrives from
  // the renderer, not from a render.
  React.useEffect(() => {
    const options: ReliefOptions = {
      ...(radiusMetres === undefined ? {} : { radiusMetres }),
      ...(peakMetres === undefined ? {} : { peakMetres }),
      ...(ceilingMetres === undefined ? {} : { ceilingMetres }),
    };
    fields.set(sourceId, { points, options });
    return () => {
      fields.delete(sourceId);
    };
  }, [sourceId, points, radiusMetres, peakMetres, ceilingMetres]);

  React.useEffect(() => registerProtocol(), []);

  // A change of points is a change of landscape, and MapLibre caches tiles by
  // URL: the generation makes them different tiles rather than stale ones.
  const generation = React.useMemo(() => points.length, [points]);

  const shadeId = `${sourceId}-shade`;

  const attach = React.useCallback(() => {
    if (!isStyleUsable(map)) return;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "raster-dem",
        tiles: [`${PROTOCOL}://${sourceId}/{z}/{x}/{y}?v=${generation}`],
        tileSize: RELIEF_TILE_SIZE,
        encoding: "terrarium",
        maxzoom,
      });
      map.setTerrain({ source: sourceId, exaggeration });

      // Terrain alone is invisible: a flat basemap draped over hills looks
      // exactly like a flat basemap except at the horizon. The shading is what
      // makes the landscape readable, so it is part of the relief rather than
      // something a caller has to remember to add.
      if (!map.getLayer(shadeId)) {
        map.addLayer(
          {
            id: shadeId,
            type: "hillshade",
            source: sourceId,
            paint: {
              "hillshade-exaggeration": 0.55,
              "hillshade-shadow-color": "#2b3a4a",
              "hillshade-highlight-color": "#ffffff",
              "hillshade-accent-color": "#5b6b7c",
            },
          },
          firstSymbolLayer(map),
        );
      }
    }
  }, [map, shadeId, sourceId, generation, maxzoom, exaggeration]);

  React.useEffect(() => {
    attach();

    return () => {
      if (!isStyleUsable(map)) return;
      // Terrain first: a source still under the terrain cannot be removed.
      map.setTerrain(null);
      if (map.getLayer(shadeId)) {
        map.removeLayer(shadeId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    };
  }, [attach, map, shadeId, sourceId]);

  // A style reload wipes sources and terrain together, so the relief has to put
  // itself back. This listens rather than depending on a style version, because
  // `setTerrain` is itself a style change: an effect that re-ran on every
  // `styledata` would tear the terrain down and rebuild it forever, and the map
  // would never finish loading.
  React.useEffect(() => {
    if (!map) return;

    const onStyleData = () => {
      attach();
    };

    map.on("styledata", onStyleData);
    return () => {
      map.off("styledata", onStyleData);
    };
  }, [map, attach]);

  return null;
};
