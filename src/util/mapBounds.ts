// Antimeridian-aware geometry helpers shared by the map components.
//
// A naive min/max over longitudes produces a near-360° viewport for a set of
// points that straddle the antimeridian (±180°) — e.g. one photo at 179° and
// one at −179° would frame the whole globe instead of a 2° hop. These helpers
// treat longitudes as points on a circle so bounds and route lines take the
// short way across the date line.

/** MapLibre corner-bounds form: `[[west, south], [east, north]]`. */
export type LngLatBoundsTuple = [[number, number], [number, number]];

/**
 * Compute a bounding box that is aware of the antimeridian.
 *
 * Longitudes are treated as points on a circle: we find the largest empty gap
 * between consecutive longitudes (including the wrap-around gap from the
 * easternmost point back to the westernmost) and fit the complement of that
 * gap — the tightest arc that still contains every point. When the tightest arc
 * crosses the antimeridian the returned west edge is greater than the east
 * edge, which MapLibre's `fitBounds`/`cameraForBounds` handles correctly via
 * `LngLatBounds.adjustAntiMeridian()` (it adds 360 to the east edge).
 *
 * @param points `[lng, lat]` pairs (MapLibre's native ordering).
 * @returns MapLibre corner bounds `[[west, south], [east, north]]`, or `null`
 *          when there are no points.
 */
export const computeWrapAwareBounds = (points: [number, number][]): LngLatBoundsTuple | null => {
  if (points.length === 0) {
    return null;
  }

  let south = Infinity;
  let north = -Infinity;
  for (const [, lat] of points) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  const lngs = points.map(([lng]) => lng).sort((a, b) => a - b);

  // Default (no wrap): the widest gap is the wrap-around gap, so the covering
  // arc is the plain [min, max] span.
  let widestGap = -Infinity;
  let west = lngs[0]!;
  let east = lngs[lngs.length - 1]!;

  for (let i = 0; i < lngs.length; i += 1) {
    const current = lngs[i]!;
    const isWrapGap = i === lngs.length - 1;
    const next = isWrapGap ? lngs[0]! + 360 : lngs[i + 1]!;
    const gap = next - current;

    if (gap > widestGap) {
      widestGap = gap;
      // The covering arc is the complement of this gap: it starts just after
      // the gap (going east) and ends just before it. For the wrap gap this is
      // the ordinary [min, max]; for an internal gap the west edge ends up
      // greater than the east edge, marking an antimeridian crossing.
      west = isWrapGap ? lngs[0]! : lngs[i + 1]!;
      east = current;
    }
  }

  return [
    [west, south],
    [east, north],
  ];
};

/**
 * Rewrite a sequence of longitudes into a continuous (unwrapped) form so a
 * polyline drawn through them crosses the antimeridian the short way rather
 * than sweeping the long way back across the whole map.
 *
 * Each longitude is shifted by whole multiples of 360° to sit within 180° of
 * the previous point, carrying the accumulated offset forward. The first point
 * is left untouched. Values may fall outside [−180, 180]; MapLibre's `project`
 * accepts them and places each on the nearest world copy.
 */
export const unwrapLongitudes = (lngs: number[]): number[] => {
  const result: number[] = [];
  lngs.forEach((lng, index) => {
    if (index === 0) {
      result.push(lng);
      return;
    }

    const previous = result[index - 1]!;
    let candidate = lng;
    while (candidate - previous > 180) candidate -= 360;
    while (candidate - previous < -180) candidate += 360;
    result.push(candidate);
  });

  return result;
};
