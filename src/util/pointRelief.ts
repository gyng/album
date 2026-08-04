/**
 * Ground that rises where the photographs are.
 *
 * A terrain renderer wants elevation tiles. It does not care where the
 * elevation came from — so this makes them out of the only landscape this site
 * actually has: fifteen hundred coordinates. Each photograph raises a soft hill
 * around itself, the hills add up, and a street shot a hundred times becomes a
 * summit while a single frame in a field is a rise you can just see.
 *
 * Pure and framework-neutral on purpose: the renderer's part is four lines of
 * "here is a tile"; everything that decides what the landscape looks like is
 * here, where it can be tested without a GPU.
 */

export type ReliefPoint = { lng: number; lat: number; weight?: number };

export type ReliefTile = { z: number; x: number; y: number };

export type ReliefOptions = {
  /** How far a single photograph's hill reaches, in metres at the equator. */
  radiusMetres?: number;
  /** Height of one photograph's hill, in metres. Hills sum, so this is a unit. */
  peakMetres?: number;
  /** Nothing rises above this, however many photographs pile up. */
  ceilingMetres?: number;
};

const DEFAULTS = {
  radiusMetres: 1200,
  peakMetres: 140,
  ceilingMetres: 2600,
} satisfies Required<ReliefOptions>;

/** The side of one elevation tile, in samples. */
export const RELIEF_TILE_SIZE = 128;

const EARTH_CIRCUMFERENCE = 40075016.686;

/** Web Mercator, normalised to 0–1 across the world. */
export const mercator = ({ lng, lat }: { lng: number; lat: number }): { x: number; y: number } => {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const radians = (clampedLat * Math.PI) / 180;
  return {
    x: (lng + 180) / 360,
    y: 0.5 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI),
  };
};

/**
 * A metre is a different number of Mercator units at the equator than at the
 * pole, and a hill that ignores that is an ellipse in Norway.
 */
const metresToMercator = (metres: number, lat: number): number =>
  metres / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180));

/**
 * Heights for one tile, row-major, in metres above sea level.
 *
 * Only the points that could possibly reach the tile are considered, which is
 * what keeps this cheap enough to run while the map is being dragged: at a
 * street zoom that is a handful of photographs, not fifteen hundred.
 */
export const reliefTileHeights = (
  tile: ReliefTile,
  points: readonly ReliefPoint[],
  options: ReliefOptions = {},
  size: number = RELIEF_TILE_SIZE,
): Float32Array => {
  const { radiusMetres, peakMetres, ceilingMetres } = { ...DEFAULTS, ...options };
  const heights = new Float32Array(size * size);

  const tiles = 2 ** tile.z;
  const tileSpan = 1 / tiles;
  const left = tile.x / tiles;
  const top = tile.y / tiles;

  // The hill's reach in Mercator units, taken at the tile's own latitude: it is
  // constant within a tile at any zoom anyone looks at terrain from.
  const centreY = top + tileSpan / 2;
  const centreLat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * centreY))) * 180) / Math.PI;
  const radius = metresToMercator(radiusMetres, centreLat);
  if (!Number.isFinite(radius) || radius <= 0) return heights;

  const nearby = points.filter((point) => {
    const at = mercator(point);
    return (
      at.x >= left - radius &&
      at.x <= left + tileSpan + radius &&
      at.y >= top - radius &&
      at.y <= top + tileSpan + radius
    );
  });
  if (nearby.length === 0) return heights;

  const projected = nearby.map((point) => ({ ...mercator(point), weight: point.weight ?? 1 }));
  const step = tileSpan / size;

  for (let row = 0; row < size; row += 1) {
    const y = top + (row + 0.5) * step;
    for (let column = 0; column < size; column += 1) {
      const x = left + (column + 0.5) * step;
      let height = 0;

      for (const point of projected) {
        const dx = (x - point.x) / radius;
        const dy = (y - point.y) / radius;
        const squared = dx * dx + dy * dy;
        if (squared >= 1) continue;
        // A raised cosine: zero and flat at the edge, so hills meet without a
        // seam and a tile boundary never becomes a cliff.
        const falloff = (1 + Math.cos(Math.PI * Math.sqrt(squared))) / 2;
        height += peakMetres * point.weight * falloff;
      }

      heights[row * size + column] = Math.min(ceilingMetres, height);
    }
  }

  return heights;
};

/**
 * Heights as Terrarium pixels: `(red * 256 + green + blue / 256) - 32768`.
 *
 * Terrarium rather than Mapbox's encoding because it is the one whose zero is a
 * flat sea and whose arithmetic is legible at a glance, and every renderer that
 * reads elevation tiles reads it.
 */
export const encodeTerrarium = (heights: Float32Array, size: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(size * size * 4);

  for (let index = 0; index < heights.length; index += 1) {
    const value = Math.max(0, Math.min(65535, Math.round((heights[index] as number) + 32768)));
    const offset = index * 4;
    pixels[offset] = Math.floor(value / 256);
    pixels[offset + 1] = value % 256;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 255;
  }

  return pixels;
};

/** Reads one pixel back, so a test can talk about metres rather than bytes. */
export const decodeTerrarium = (pixels: Uint8ClampedArray, index: number): number => {
  const offset = index * 4;
  return (
    (pixels[offset] ?? 0) * 256 +
    (pixels[offset + 1] ?? 0) +
    (pixels[offset + 2] ?? 0) / 256 -
    32768
  );
};
