import {
  buildSilenceBands,
  buildZoneAxis,
  fractionalYear,
  parseUtcOffsetHours,
} from "./exploreTimeViz";

const zone = (name: string, offsets: string[], count: number, sharePercent = 1) => ({
  name,
  offsets,
  count,
  sharePercent,
});

describe("parseUtcOffsetHours", () => {
  it("reads an offset either side of UTC, half hours included", () => {
    expect(parseUtcOffsetHours("+09:00")).toBe(9);
    expect(parseUtcOffsetHours("-07:00")).toBe(-7);
    expect(parseUtcOffsetHours("+05:30")).toBe(5.5);
  });

  it("rejects anything that is not one", () => {
    expect(parseUtcOffsetHours("Asia/Tokyo")).toBeNull();
    expect(parseUtcOffsetHours(null)).toBeNull();
  });
});

describe("buildZoneAxis", () => {
  it("puts the zones on one clock, ordered west to east", () => {
    const columns = buildZoneAxis([
      zone("Asia/Tokyo", ["+09:00"], 942),
      zone("America/Los_Angeles", ["-07:00"], 55),
      zone("Asia/Singapore", ["+08:00"], 274),
    ]);

    expect(columns.map((column) => column.hours)).toEqual([-7, 8, 9]);
    expect(columns[0]?.position).toBe(0);
    expect(columns[columns.length - 1]?.position).toBe(100);
  });

  it("stacks the zones that share an offset, commonest first", () => {
    const columns = buildZoneAxis([
      zone("Asia/Singapore", ["+08:00"], 274),
      zone("Asia/Taipei", ["+08:00"], 45),
      zone("Asia/Tokyo", ["+09:00"], 942),
    ]);

    expect(columns[0]?.zones.map((entry) => entry.name)).toEqual(["Asia/Singapore", "Asia/Taipei"]);
  });

  // The whole point of the panel: the offset is resolved per photograph from
  // where it was taken, so a place that changes with the season stands in two
  // columns rather than being averaged into one.
  it("stands a seasonal zone in both of its offsets, and says so", () => {
    const columns = buildZoneAxis([zone("Australia/Melbourne", ["+10:00", "+11:00"], 11)]);

    expect(columns).toHaveLength(2);
    expect(columns.every((column) => column.zones[0]?.seasonal)).toBe(true);
  });

  it("centres a single offset rather than dividing by nothing", () => {
    expect(buildZoneAxis([zone("Asia/Tokyo", ["+09:00"], 5)])[0]?.position).toBe(50);
  });

  it("ignores a zone whose offset it cannot read", () => {
    expect(buildZoneAxis([zone("Nowhere", ["unknown"], 3)])).toEqual([]);
  });
});

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
