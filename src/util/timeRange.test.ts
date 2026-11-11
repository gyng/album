import {
  parseTimestampSafe,
  computeDateExtent,
  computeSparklineBins,
  positionToMs,
  msToPosition,
  formatRangeDate,
  formatDisplayDate,
  formatRangeParam,
  parseRangeParam,
  snapRangeToSeconds,
} from "./timeRange";
import { exifWallClockTimestamp } from "./exifTime";

describe("parseTimestampSafe", () => {
  it("reads a naive ISO capture time as its wall clock", () => {
    expect(parseTimestampSafe("2024-03-22T10:00:00")).toBe(Date.UTC(2024, 2, 22, 10, 0, 0));
  });

  it("parses EXIF colon-separated dates", () => {
    expect(parseTimestampSafe("2024:03:22 10:00:00")).toBe(Date.UTC(2024, 2, 22, 10, 0, 0));
  });

  // The filter reads `exifWallClockTimestamp`; an extent on the reader's own
  // clock sat eight hours from it in UTC+8, so dragging one thumb set the other
  // to an "end" that excluded the newest photos. Jest cannot change the zone
  // mid-run, so this pins the coordinate itself: it fails on any machine that
  // is not on UTC the moment the parse goes back through the reader's zone.
  it("puts the extent on the filter's clock", () => {
    expect(
      computeDateExtent([{ date: "2024-03-01T08:00:00" }, { date: "2024-03-22T23:30:00" }]),
    ).toEqual({
      minMs: exifWallClockTimestamp("2024-03-01T08:00:00"),
      maxMs: exifWallClockTimestamp("2024-03-22T23:30:00"),
    });
  });

  it("returns null for null/undefined/empty", () => {
    expect(parseTimestampSafe(null)).toBeNull();
    expect(parseTimestampSafe(undefined)).toBeNull();
    expect(parseTimestampSafe("")).toBeNull();
  });

  it("returns null for unparseable strings", () => {
    expect(parseTimestampSafe("not-a-date")).toBeNull();
  });
});

describe("computeDateExtent", () => {
  it("returns min/max from dated entries", () => {
    const entries = [
      { date: "2024-01-01T00:00:00Z" },
      { date: "2024-06-15T00:00:00Z" },
      { date: "2024-03-10T00:00:00Z" },
    ];
    const extent = computeDateExtent(entries);
    expect(extent).toEqual({
      minMs: new Date("2024-01-01T00:00:00Z").valueOf(),
      maxMs: new Date("2024-06-15T00:00:00Z").valueOf(),
    });
  });

  it("ignores entries with null dates", () => {
    const entries = [
      { date: null },
      { date: "2024-01-01T00:00:00Z" },
      { date: null },
      { date: "2024-12-31T00:00:00Z" },
    ];
    const extent = computeDateExtent(entries);
    expect(extent).toEqual({
      minMs: new Date("2024-01-01T00:00:00Z").valueOf(),
      maxMs: new Date("2024-12-31T00:00:00Z").valueOf(),
    });
  });

  it("returns null for fewer than 2 dated entries", () => {
    expect(computeDateExtent([{ date: "2024-01-01T00:00:00" }])).toBeNull();
    expect(computeDateExtent([])).toBeNull();
    expect(computeDateExtent([{ date: null }])).toBeNull();
  });

  it("returns null when all dates are identical", () => {
    const entries = [{ date: "2024-06-01T00:00:00Z" }, { date: "2024-06-01T00:00:00Z" }];
    expect(computeDateExtent(entries)).toBeNull();
  });
});

describe("computeSparklineBins", () => {
  const extent = {
    minMs: new Date("2024-01-01T00:00:00Z").valueOf(),
    maxMs: new Date("2024-12-31T00:00:00Z").valueOf(),
  };

  it("distributes entries into bins", () => {
    const entries = [
      { date: "2024-01-01T00:00:00Z" },
      { date: "2024-01-02T00:00:00Z" },
      { date: "2024-12-30T00:00:00Z" },
    ];
    const bins = computeSparklineBins(entries, extent, 10);
    expect(bins.length).toBe(10);
    // First two entries in bin 0, last entry in bin 9
    expect(bins[0]).toBe(2);
    expect(bins[9]).toBe(1);
    expect(bins.slice(1, 9).every((b) => b === 0)).toBe(true);
  });

  it("ignores entries with null dates", () => {
    const entries = [{ date: null }, { date: "2024-06-15T00:00:00Z" }];
    const bins = computeSparklineBins(entries, extent, 4);
    expect(bins.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("returns all zeros for empty entries", () => {
    const bins = computeSparklineBins([], extent, 5);
    expect(bins).toEqual([0, 0, 0, 0, 0]);
  });

  it("returns all zeros for a zero-width extent", () => {
    expect(
      computeSparklineBins([{ date: "2024-01-01T00:00:00" }], { minMs: 10, maxMs: 10 }, 3),
    ).toEqual([0, 0, 0]);
  });

  it("places the max-date entry in the last bin", () => {
    const entries = [{ date: "2024-12-31T00:00:00Z" }];
    const bins = computeSparklineBins(entries, extent, 10);
    expect(bins[9]).toBe(1);
  });
});

describe("positionToMs / msToPosition", () => {
  const extent = { minMs: 1000, maxMs: 2000 };

  it("converts position to ms", () => {
    expect(positionToMs(0, extent)).toBe(1000);
    expect(positionToMs(0.5, extent)).toBe(1500);
    expect(positionToMs(1, extent)).toBe(2000);
  });

  it("converts ms to position", () => {
    expect(msToPosition(1000, extent)).toBe(0);
    expect(msToPosition(1500, extent)).toBe(0.5);
    expect(msToPosition(2000, extent)).toBe(1);
  });

  it("round-trips correctly", () => {
    expect(positionToMs(msToPosition(1750, extent), extent)).toBe(1750);
  });
});

describe("formatRangeDate", () => {
  it("formats epoch ms as YYYY-MM-DD", () => {
    expect(formatRangeDate(new Date("2024-03-22T10:00:00Z").valueOf())).toBe("2024-03-22");
  });
});

describe("formatDisplayDate", () => {
  it("formats epoch ms as human-readable date", () => {
    const result = formatDisplayDate(new Date("2024-03-22T00:00:00Z").valueOf());
    expect(result).toBe("22 Mar 2024");
  });
});

describe("parseRangeParam", () => {
  it("parses valid YYYY-MM-DD params", () => {
    const result = parseRangeParam("2024-03-22");
    expect(result).toBe(new Date("2024-03-22T00:00:00Z").valueOf());
  });

  it("can parse an end-of-day bound for the upper range", () => {
    const result = parseRangeParam("2024-03-22", { endOfDay: true });
    expect(result).toBe(new Date("2024-03-22T23:59:59.999Z").valueOf());
  });

  it("parses a bound that carries its time, whichever end it is", () => {
    const expected = Date.UTC(2024, 2, 22, 14, 5, 9);
    expect(parseRangeParam("2024-03-22T14:05:09")).toBe(expected);
    expect(parseRangeParam("2024-03-22T14:05:09", { endOfDay: true })).toBe(expected);
  });

  it("returns null for null/invalid formats", () => {
    expect(parseRangeParam(null)).toBeNull();
    expect(parseRangeParam("")).toBeNull();
    expect(parseRangeParam("2024-3-22")).toBeNull();
    expect(parseRangeParam("not-a-date")).toBeNull();
    expect(parseRangeParam("2024-99-99")).toBeNull();
  });
});

describe("formatRangeParam", () => {
  it("keeps the short form on a day boundary", () => {
    expect(formatRangeParam(Date.UTC(2024, 2, 22))).toBe("2024-03-22");
    expect(formatRangeParam(Date.UTC(2024, 2, 22, 23, 59, 59, 999), { endOfDay: true })).toBe(
      "2024-03-22",
    );
  });

  // A one-day album could not be narrowed: the URL held whole days only, and
  // the range read back from it replaced the one just chosen.
  it("round-trips a range narrower than a day", () => {
    const { fromMs, toMs } = snapRangeToSeconds(
      Date.UTC(2024, 2, 22, 9, 15, 0, 400),
      Date.UTC(2024, 2, 22, 11, 45, 30, 600),
    );
    const from = formatRangeParam(fromMs);
    const to = formatRangeParam(toMs, { endOfDay: true });

    expect(from).toBe("2024-03-22T09:15:01");
    expect(to).toBe("2024-03-22T11:45:30");
    expect(parseRangeParam(from)).toBe(fromMs);
    expect(parseRangeParam(to, { endOfDay: true })).toBe(toMs);
  });
});

describe("snapRangeToSeconds", () => {
  it("never moves a bound across a whole-second capture time", () => {
    const photo = Date.UTC(2024, 2, 22, 9, 15, 1);
    expect(snapRangeToSeconds(photo - 1, photo + 1)).toEqual({ fromMs: photo, toMs: photo });
    expect(snapRangeToSeconds(photo + 1, photo + 5000).fromMs).toBeGreaterThan(photo);
    expect(snapRangeToSeconds(photo - 5000, photo - 1).toMs).toBeLessThan(photo);
  });
});
