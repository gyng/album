import {
  parseExifOffset,
  localExifToUtc,
  deriveOffsetFromGps,
  offsetForZoneAt,
  resolveOffset,
} from "./gpsOffset";

const parts = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
) => ({ year, month, day, hour, minute, second });

describe("parseExifOffset", () => {
  it("parses the EXIF offset forms to signed minutes", () => {
    expect(parseExifOffset("+08:00")).toBe(480);
    expect(parseExifOffset("-05:30")).toBe(-330);
    expect(parseExifOffset("+0900")).toBe(540);
    expect(parseExifOffset("+08")).toBe(480);
    expect(parseExifOffset("Z")).toBe(0);
  });

  it("returns null for junk or empty", () => {
    expect(parseExifOffset("")).toBeNull();
    expect(parseExifOffset("nonsense")).toBeNull();
    expect(parseExifOffset("+99:99")).toBeNull();
  });
});

describe("localExifToUtc", () => {
  it("subtracts the offset from the nominal wall-clock", () => {
    // 18:30 local at +08:00 is 10:30 UTC the same day
    expect(localExifToUtc(parts(2024, 3, 22, 18, 30), 480)).toBe(Date.UTC(2024, 2, 22, 10, 30, 0));
    // 01:00 local at -05:00 is 06:00 UTC same day
    expect(localExifToUtc(parts(2024, 3, 22, 1, 0), -300)).toBe(Date.UTC(2024, 2, 22, 6, 0, 0));
  });
});

describe("deriveOffsetFromGps", () => {
  it("derives the offset from local wall-clock vs the GPS UTC fix, rounded to 15 min", () => {
    const gpsUtc = Date.UTC(2024, 2, 22, 10, 30, 0);
    expect(deriveOffsetFromGps(parts(2024, 3, 22, 18, 30), gpsUtc)).toBe(480);
    // a few seconds of skew still rounds cleanly
    expect(deriveOffsetFromGps(parts(2024, 3, 22, 18, 30, 7), gpsUtc)).toBe(480);
  });
});

describe("offsetForZoneAt", () => {
  it("returns a fixed offset for a non-DST zone", () => {
    expect(offsetForZoneAt("Asia/Tokyo", Date.UTC(2024, 0, 1))).toBe(540);
    expect(offsetForZoneAt("Asia/Tokyo", Date.UTC(2024, 6, 1))).toBe(540);
  });

  it("is DST-aware for a zone that observes it", () => {
    expect(offsetForZoneAt("America/New_York", Date.UTC(2024, 6, 1))).toBe(-240); // EDT
    expect(offsetForZoneAt("America/New_York", Date.UTC(2024, 0, 1))).toBe(-300); // EST
  });
});

describe("resolveOffset", () => {
  const gps = { localParts: parts(2024, 3, 22, 18, 30), gpsUtcMs: Date.UTC(2024, 2, 22, 10, 30) };

  it("prefers a per-photo OffsetTimeOriginal above everything", () => {
    expect(resolveOffset({ offsetTimeOriginal: "+09:00", gps, manualMinutes: 0 })).toEqual({
      offsetMinutes: 540,
      source: "exif-offsettime",
    });
  });

  it("falls back to GPS self-calibration, then track timezone, then manual", () => {
    expect(resolveOffset({ gps })).toEqual({
      offsetMinutes: 480,
      source: "gps-selfcalibration",
    });
    expect(
      resolveOffset({ track: { zone: "Asia/Tokyo", sampleUtcMs: Date.UTC(2024, 2, 22) } }),
    ).toEqual({ offsetMinutes: 540, source: "track-timezone" });
    expect(resolveOffset({ manualMinutes: -330 })).toEqual({
      offsetMinutes: -330,
      source: "manual",
    });
  });

  it("returns null when nothing is available", () => {
    expect(resolveOffset({})).toBeNull();
  });
});
