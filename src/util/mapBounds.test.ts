import { computeWrapAwareBounds, unwrapLongitudes } from "./mapBounds";

describe("computeWrapAwareBounds", () => {
  it("returns null for no points", () => {
    expect(computeWrapAwareBounds([])).toBeNull();
  });

  it("frames an ordinary cluster with plain min/max bounds", () => {
    const bounds = computeWrapAwareBounds([
      [0, 0],
      [10, 5],
      [20, -5],
    ]);

    expect(bounds).toEqual([
      [0, -5],
      [20, 5],
    ]);
  });

  it("crosses the antimeridian for points straddling ±180 (short way)", () => {
    const bounds = computeWrapAwareBounds([
      [179, 10],
      [-179, 20],
    ]);

    // West edge (179) is greater than the east edge (−179): MapLibre reads this
    // as an antimeridian crossing spanning just 2°, not a 358° globe-wide box.
    expect(bounds).toEqual([
      [179, 10],
      [-179, 20],
    ]);
    const [[west], [east]] = bounds!;
    expect(west).toBeGreaterThan(east);
  });

  it("fits the tight complement around a Pacific cluster", () => {
    const bounds = computeWrapAwareBounds([
      [-170, 0],
      [-160, 0],
      [160, 0],
      [170, 0],
    ]);

    // Widest empty gap is between −160 and 160, so the covering arc runs from
    // 160 east across the date line to −160.
    expect(bounds).toEqual([
      [160, 0],
      [-160, 0],
    ]);
  });

  it("keeps a normal box when the widest gap is the wrap gap", () => {
    // Points span −20..20 near the prime meridian; the largest empty arc is the
    // wrap-around gap through the antimeridian, so no crossing.
    const bounds = computeWrapAwareBounds([
      [-20, -10],
      [0, 0],
      [20, 10],
    ]);

    expect(bounds).toEqual([
      [-20, -10],
      [20, 10],
    ]);
    const [[west], [east]] = bounds!;
    expect(west).toBeLessThan(east);
  });

  it("handles a single point as a degenerate box", () => {
    expect(computeWrapAwareBounds([[139.7, 35.6]])).toEqual([
      [139.7, 35.6],
      [139.7, 35.6],
    ]);
  });
});

describe("unwrapLongitudes", () => {
  it("leaves an ordinary sequence untouched", () => {
    expect(unwrapLongitudes([0, 10, 20])).toEqual([0, 10, 20]);
  });

  it("continues eastward across the antimeridian", () => {
    // 170 → −170 is a 20° hop east, expressed as 190 so the polyline stays
    // continuous rather than sweeping 340° back across the map.
    expect(unwrapLongitudes([170, -170, -160])).toEqual([170, 190, 200]);
  });

  it("continues westward across the antimeridian", () => {
    expect(unwrapLongitudes([-170, 170, 160])).toEqual([-170, -190, -200]);
  });

  it("leaves the first point unchanged", () => {
    expect(unwrapLongitudes([179])).toEqual([179]);
  });
});
