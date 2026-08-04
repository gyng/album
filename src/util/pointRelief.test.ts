import {
  decodeTerrarium,
  encodeTerrarium,
  mercator,
  RELIEF_TILE_SIZE,
  reliefTileHeights,
} from "./pointRelief";

const SIZE = 32;

/** The tile containing a coordinate at a given zoom. */
const tileAt = (lng: number, lat: number, z: number) => {
  const at = mercator({ lng, lat });
  const tiles = 2 ** z;
  return { z, x: Math.floor(at.x * tiles), y: Math.floor(at.y * tiles) };
};

const highest = (heights: Float32Array) => Math.max(...heights);

describe("mercator", () => {
  it("puts the null island in the middle and the poles at the edges", () => {
    expect(mercator({ lng: 0, lat: 0 })).toEqual({ x: 0.5, y: 0.5 });
    expect(mercator({ lng: -180, lat: 0 }).x).toBe(0);
    expect(mercator({ lng: 0, lat: 85 }).y).toBeLessThan(0.01);
  });

  // Web Mercator has no poles, and a latitude past its limit would otherwise
  // project to infinity and take every height with it.
  it("clamps beyond the projection's own limit", () => {
    expect(Number.isFinite(mercator({ lng: 0, lat: 90 }).y)).toBe(true);
    expect(Number.isFinite(mercator({ lng: 0, lat: -90 }).y)).toBe(true);
  });
});

describe("reliefTileHeights", () => {
  it("is flat where nothing was photographed", () => {
    const heights = reliefTileHeights(tileAt(139.767, 35.681, 12), [], {}, SIZE);

    expect(highest(heights)).toBe(0);
    expect(heights).toHaveLength(SIZE * SIZE);
  });

  it("raises ground around a photograph", () => {
    const point = { lng: 139.767, lat: 35.681 };
    const heights = reliefTileHeights(tileAt(point.lng, point.lat, 12), [point], {}, SIZE);

    expect(highest(heights)).toBeGreaterThan(50);
  });

  // The whole idea: a street photographed a hundred times is a summit, and a
  // single frame in a field is a rise you can just see.
  it("stacks hills, so the most photographed place is the highest", () => {
    const point = { lng: 139.767, lat: 35.681 };
    const tile = tileAt(point.lng, point.lat, 12);
    const once = reliefTileHeights(tile, [point], {}, SIZE);
    const often = reliefTileHeights(
      tile,
      Array.from({ length: 8 }, () => point),
      {},
      SIZE,
    );

    expect(highest(often)).toBeGreaterThan(highest(once) * 5);
  });

  it("never rises above its ceiling, however many photographs pile up", () => {
    const point = { lng: 139.767, lat: 35.681 };
    const heights = reliefTileHeights(
      tileAt(point.lng, point.lat, 12),
      Array.from({ length: 500 }, () => point),
      { ceilingMetres: 900 },
      SIZE,
    );

    expect(highest(heights)).toBeLessThanOrEqual(900);
    expect(highest(heights)).toBeGreaterThan(800);
  });

  it("weights a photograph that stands for several", () => {
    const point = { lng: 139.767, lat: 35.681 };
    const tile = tileAt(point.lng, point.lat, 12);

    expect(highest(reliefTileHeights(tile, [{ ...point, weight: 4 }], {}, SIZE))).toBeCloseTo(
      highest(reliefTileHeights(tile, [point], {}, SIZE)) * 4,
      3,
    );
  });

  // A hill that reached a fixed number of Mercator units would be an ellipse in
  // Norway and a dot on the equator; a metre is not a constant here.
  it("keeps a hill the same size on the ground at any latitude", () => {
    // How far the hill reaches, measured in metres on the ground rather than in
    // projected units — the two differ by a factor of two at 60°.
    const reachMetres = (lat: number) => {
      const point = { lng: 0, lat };
      const tile = tileAt(point.lng, point.lat, 10);
      const heights = reliefTileHeights(tile, [point], { radiusMetres: 3000 }, SIZE);
      const tiles = 2 ** tile.z;
      const at = mercator(point);
      const metresPerUnit = 40075016.686 * Math.cos((lat * Math.PI) / 180);

      let furthest = 0;
      for (let index = 0; index < heights.length; index += 1) {
        if ((heights[index] ?? 0) <= 0) continue;
        const x = (tile.x + ((index % SIZE) + 0.5) / SIZE) / tiles;
        const y = (tile.y + (Math.floor(index / SIZE) + 0.5) / SIZE) / tiles;
        furthest = Math.max(furthest, Math.hypot(x - at.x, y - at.y) * metresPerUnit);
      }

      return furthest;
    };

    // Both land within a sample or so of the radius asked for; without the
    // latitude correction the northern hill would reach twice as far.
    for (const lat of [0, 60]) {
      expect(reachMetres(lat)).toBeGreaterThan(2000);
      expect(reachMetres(lat)).toBeLessThan(3600);
    }
  });

  // Hills that did not reach zero at their edge would leave a step at every
  // tile boundary, and the terrain would look like a chessboard.
  it("falls to nothing at the edge of a hill", () => {
    const point = { lng: 0, lat: 0 };
    const tile = tileAt(point.lng, point.lat, 6);
    const heights = reliefTileHeights(tile, [point], { radiusMetres: 400 }, SIZE);

    // A 400m hill cannot reach the corner of a zoom-6 tile.
    expect(heights[0]).toBe(0);
    expect(heights[heights.length - 1]).toBe(0);
  });

  it("still lifts a tile from a photograph just outside it", () => {
    const point = { lng: 0.0, lat: 0.0 };
    const inside = tileAt(0, 0, 12);
    const neighbour = { ...inside, x: inside.x - 1 };
    const heights = reliefTileHeights(neighbour, [point], { radiusMetres: 20000 }, SIZE);

    expect(highest(heights)).toBeGreaterThan(0);
  });

  // A hill with no radius is not a hill, and the arithmetic that follows would
  // divide by it.
  it("stays flat rather than dividing by a hill with no size", () => {
    const point = { lng: 139.767, lat: 35.681 };
    const heights = reliefTileHeights(
      tileAt(point.lng, point.lat, 12),
      [point],
      { radiusMetres: 0 },
      SIZE,
    );

    expect(highest(heights)).toBe(0);
  });

  it("draws a tile of the size it was asked for", () => {
    expect(reliefTileHeights({ z: 0, x: 0, y: 0 }, [])).toHaveLength(
      RELIEF_TILE_SIZE * RELIEF_TILE_SIZE,
    );
  });
});

describe("terrarium encoding", () => {
  it("round-trips a height through the pixels a renderer reads", () => {
    const heights = new Float32Array([0, 1, 512, 2600]);
    const pixels = encodeTerrarium(heights, 2);

    for (let index = 0; index < heights.length; index += 1) {
      expect(decodeTerrarium(pixels, index)).toBeCloseTo(heights[index] ?? 0, 3);
    }
  });

  it("writes sea level as the encoding's own zero", () => {
    const pixels = encodeTerrarium(new Float32Array([0]), 1);

    expect([pixels[0], pixels[1], pixels[2]]).toEqual([128, 0, 0]);
    expect(pixels[3]).toBe(255);
  });

  it("reads a pixel that is not there as sea level", () => {
    expect(decodeTerrarium(encodeTerrarium(new Float32Array([0]), 1), 99)).toBe(-32768);
  });

  it("cannot be pushed out of range by an absurd height", () => {
    const pixels = encodeTerrarium(new Float32Array([-1e9, 1e9]), 2);

    expect(decodeTerrarium(pixels, 0)).toBe(-32768);
    expect(decodeTerrarium(pixels, 1)).toBeLessThanOrEqual(32767);
  });
});
