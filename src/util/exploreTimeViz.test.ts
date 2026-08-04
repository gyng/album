import { buildSilenceBands, fractionalYear } from "./exploreTimeViz";

describe("fractionalYear", () => {
  it("places a day inside its year", () => {
    expect(fractionalYear("2016-01-01")).toBe(2016);
    expect(fractionalYear("2016-07-01")).toBeCloseTo(2016.5, 2);
  });

  it("returns nothing for a date it cannot read", () => {
    expect(fractionalYear("not a date")).toBeNull();
  });
});

describe("buildSilenceBands", () => {
  // "3.4 years" says how long. Where it sits says which years of this archive
  // were quiet, which is what a ranked list cannot show.
  it("places each silence on the archive's own life", () => {
    const bands = buildSilenceBands(
      [{ days: 1250, fromDate: "2011-12-15", toDate: "2015-05-18" }],
      [2010, 2026],
    );

    expect(bands).toHaveLength(1);
    expect(bands[0]?.start).toBeCloseTo(((2011.95 - 2010) / 17) * 100, 0);
    expect(bands[0]?.width).toBeGreaterThan(0);
  });

  it("has nothing to place when the archive has no dates at all", () => {
    expect(
      buildSilenceBands([{ days: 10, fromDate: "2011-01-01", toDate: "2011-01-11" }], null),
    ).toEqual([]);
  });

  it("keeps a silence inside the track even when it runs to the very end", () => {
    const bands = buildSilenceBands(
      [{ days: 40, fromDate: "2026-11-01", toDate: "2026-12-11" }],
      [2026, 2026],
    );

    expect(bands[0]!.start + bands[0]!.width).toBeLessThanOrEqual(100);
  });
});
