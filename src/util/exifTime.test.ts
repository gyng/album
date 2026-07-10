import {
  dateToNaiveIso,
  exifDayKey,
  exifWallClockTimestamp,
  formatExifWallClockDate,
  formatExifWallClockDateTime,
  formatExifWallClockIso,
  normaliseExifWallClockIso,
  parseExifLocalDateTime,
} from "./exifTime";

describe("parseExifLocalDateTime", () => {
  it("parses standard EXIF format YYYY:MM:DD HH:MM:SS", () => {
    expect(parseExifLocalDateTime("2024:03:22 18:30:00")).toEqual({
      year: 2024, month: 3, day: 22, hour: 18, minute: 30, second: 0,
    });
  });

  it("parses ISO format YYYY-MM-DDTHH:MM:SS", () => {
    expect(parseExifLocalDateTime("2024-03-22T18:30:00")).toEqual({
      year: 2024, month: 3, day: 22, hour: 18, minute: 30, second: 0,
    });
  });

  it("parses space-separated ISO format YYYY-MM-DD HH:MM:SS", () => {
    expect(parseExifLocalDateTime("2024-03-22 18:30:00")).toEqual({
      year: 2024, month: 3, day: 22, hour: 18, minute: 30, second: 0,
    });
  });

  it("preserves local hour — does not apply timezone conversion", () => {
    // Golden hour at 17:45 local time should stay 17, not drift to UTC
    const result = parseExifLocalDateTime("2019:11:07 17:45:12");
    expect(result?.hour).toBe(17);
    expect(result?.year).toBe(2019);
  });

  it("handles midnight correctly", () => {
    expect(parseExifLocalDateTime("2023:06:01 00:00:00")?.hour).toBe(0);
  });

  it("handles end of day correctly", () => {
    expect(parseExifLocalDateTime("2023:06:01 23:59:59")?.hour).toBe(23);
  });

  it("returns null for null/undefined/empty", () => {
    expect(parseExifLocalDateTime(null)).toBeNull();
    expect(parseExifLocalDateTime(undefined)).toBeNull();
    expect(parseExifLocalDateTime("")).toBeNull();
  });

  it("returns null for unparseable string", () => {
    expect(parseExifLocalDateTime("not a date")).toBeNull();
    expect(parseExifLocalDateTime("2024/03/22 18:30:00")).toBeNull();
  });

  it("returns null for out-of-range values", () => {
    expect(parseExifLocalDateTime("2024:13:01 00:00:00")).toBeNull(); // month 13
    expect(parseExifLocalDateTime("2024:03:01 25:00:00")).toBeNull(); // hour 25
    expect(parseExifLocalDateTime("1800:01:01 00:00:00")).toBeNull(); // year too old
  });

  it("handles timezone suffix gracefully — ignores suffix, uses local time", () => {
    // Some cameras append offset like "2024:03:22 18:30:00+09:00"
    // We take the local part only
    const result = parseExifLocalDateTime("2024:03:22 18:30:00+09:00");
    expect(result?.hour).toBe(18);
  });
});

describe("formatExifWallClockIso", () => {
  it("round-trips EXIF format to naive ISO", () => {
    const dt = parseExifLocalDateTime("2024:03:22 06:30:05");
    expect(formatExifWallClockIso(dt!)).toBe("2024-03-22T06:30:05");
  });

  it("zero-pads all components", () => {
    const dt = parseExifLocalDateTime("2024:01:02 03:04:05");
    expect(formatExifWallClockIso(dt!)).toBe("2024-01-02T03:04:05");
  });
});

describe("normaliseExifWallClockIso", () => {
  it("normalises EXIF and zoned-looking inputs without shifting the wall clock", () => {
    expect(normaliseExifWallClockIso("2024:01:01 00:30:00+09:00")).toBe(
      "2024-01-01T00:30:00",
    );
    expect(normaliseExifWallClockIso("2024-01-01T00:30:00Z")).toBe(
      "2024-01-01T00:30:00",
    );
  });

  it("returns null for missing or malformed input", () => {
    expect(normaliseExifWallClockIso(undefined)).toBeNull();
    expect(normaliseExifWallClockIso("not-a-date")).toBeNull();
  });
});

describe("wall-clock presentation helpers", () => {
  it("formats the parsed camera date and time without runtime timezone conversion", () => {
    const raw = "2024-01-01T00:30:00+09:00";
    expect(formatExifWallClockDate(raw)).toBe("1 January 2024");
    expect(formatExifWallClockDateTime(raw)).toBe(
      "1 January 2024 at 00:30",
    );
  });

  it("creates the same nominal timestamp for equivalent wall-clock inputs", () => {
    expect(exifWallClockTimestamp("2024:01:01 00:30:00+09:00")).toBe(
      exifWallClockTimestamp("2024-01-01T00:30:00Z"),
    );
  });
});

describe("exifDayKey", () => {
  it("derives the wall-clock day from EXIF format", () => {
    expect(exifDayKey("2024:03:22 06:30:00")).toBe("2024-03-22");
  });

  it("derives the wall-clock day from naive ISO", () => {
    // An early-morning photo must stay on its own calendar day —
    // never shifted by the build machine's timezone
    expect(exifDayKey("2024-03-22T00:30:00")).toBe("2024-03-22");
  });

  it("returns null for missing or malformed input", () => {
    expect(exifDayKey(null)).toBeNull();
    expect(exifDayKey(undefined)).toBeNull();
    expect(exifDayKey("not a date")).toBeNull();
  });
});

describe("dateToNaiveIso", () => {
  it("serialises a Date using its local wall-clock components", () => {
    // Constructed locally, so the components below are the wall clock on
    // any machine — the output must not depend on the machine's zone
    const date = new Date(2024, 2, 22, 6, 30, 5);
    expect(dateToNaiveIso(date)).toBe("2024-03-22T06:30:05");
  });

  it("round-trips through parseExifLocalDateTime", () => {
    const date = new Date(2026, 11, 31, 23, 59, 59);
    expect(parseExifLocalDateTime(dateToNaiveIso(date))).toEqual({
      year: 2026, month: 12, day: 31, hour: 23, minute: 59, second: 59,
    });
  });
});
