import {
  dateToNaiveIso,
  exifDayKey,
  exifInstantTimestamp,
  exifRelativeTimestamp,
  exifViewerLocalTimestamp,
  exifWallClockTimestamp,
  formatExifOffsetSuffix,
  parseExifOffsetMinutes,
  formatExifWallClockDate,
  formatExifWallClockDateTime,
  formatExifWallClockIso,
  normaliseExifWallClockIso,
  parseExifLocalDateTime,
} from "./exifTime";

describe("parseExifLocalDateTime", () => {
  it("parses standard EXIF format YYYY:MM:DD HH:MM:SS", () => {
    expect(parseExifLocalDateTime("2024:03:22 18:30:00")).toEqual({
      year: 2024,
      month: 3,
      day: 22,
      hour: 18,
      minute: 30,
      second: 0,
    });
  });

  it("parses ISO format YYYY-MM-DDTHH:MM:SS", () => {
    expect(parseExifLocalDateTime("2024-03-22T18:30:00")).toEqual({
      year: 2024,
      month: 3,
      day: 22,
      hour: 18,
      minute: 30,
      second: 0,
    });
  });

  it("parses space-separated ISO format YYYY-MM-DD HH:MM:SS", () => {
    expect(parseExifLocalDateTime("2024-03-22 18:30:00")).toEqual({
      year: 2024,
      month: 3,
      day: 22,
      hour: 18,
      minute: 30,
      second: 0,
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
    expect(parseExifLocalDateTime("2024:00:01 00:00:00")).toBeNull(); // month 0
    expect(parseExifLocalDateTime("2024:03:00 00:00:00")).toBeNull(); // day 0
    expect(parseExifLocalDateTime("2024:03:32 00:00:00")).toBeNull(); // day 32
    expect(parseExifLocalDateTime("2024:03:01 25:00:00")).toBeNull(); // hour 25
    expect(parseExifLocalDateTime("2024:03:01 23:60:00")).toBeNull(); // minute 60
    expect(parseExifLocalDateTime("2024:03:01 23:59:60")).toBeNull(); // second 60
    expect(parseExifLocalDateTime("1800:01:01 00:00:00")).toBeNull(); // year too old
    expect(parseExifLocalDateTime("2200:01:01 00:00:00")).toBeNull(); // year too new
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
    expect(normaliseExifWallClockIso("2024:01:01 00:30:00+09:00")).toBe("2024-01-01T00:30:00");
    expect(normaliseExifWallClockIso("2024-01-01T00:30:00Z")).toBe("2024-01-01T00:30:00");
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
    expect(formatExifWallClockDateTime(raw)).toBe("1 January 2024 at 00:30");
  });

  it("creates the same nominal timestamp for equivalent wall-clock inputs", () => {
    expect(exifWallClockTimestamp("2024:01:01 00:30:00+09:00")).toBe(
      exifWallClockTimestamp("2024-01-01T00:30:00Z"),
    );
  });

  it("returns null for malformed wall-clock presentation inputs", () => {
    expect(exifWallClockTimestamp("not-a-date")).toBeNull();
    expect(formatExifWallClockDate("not-a-date")).toBeNull();
    expect(formatExifWallClockDateTime("not-a-date")).toBeNull();
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
      year: 2026,
      month: 12,
      day: 31,
      hour: 23,
      minute: 59,
      second: 59,
    });
  });
});

describe("exifViewerLocalTimestamp", () => {
  // Written to hold in any zone: locally these tests run in Asia/Singapore, CI
  // runs in UTC, and in UTC the two helpers coincide — so asserting a numeric
  // gap between them would pass vacuously on CI.
  it("places the wall clock in the viewer's zone, so local getters read it back", () => {
    const ms = exifViewerLocalTimestamp("2026:08:01 16:55:08")!;
    const asDate = new Date(ms);

    expect(asDate.getFullYear()).toBe(2026);
    expect(asDate.getMonth()).toBe(7);
    expect(asDate.getDate()).toBe(1);
    expect(asDate.getHours()).toBe(16);
    expect(asDate.getMinutes()).toBe(55);
  });

  it("leaves the ordering helper anchored to UTC, where UTC getters read it back", () => {
    const asDate = new Date(exifWallClockTimestamp("2026:08:01 16:55:08")!);

    expect(asDate.getUTCHours()).toBe(16);
    expect(asDate.getUTCDate()).toBe(1);
  });

  // The bug: a photo taken three hours ago read as taken in the future,
  // because a UTC-anchored wall clock was compared against a real Date.now().
  it("reports a photo taken earlier today as past, not future", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const pad = (value: number) => String(value).padStart(2, "0");
    const wallClock =
      `${threeHoursAgo.getFullYear()}:${pad(threeHoursAgo.getMonth() + 1)}:` +
      `${pad(threeHoursAgo.getDate())} ${pad(threeHoursAgo.getHours())}:` +
      `${pad(threeHoursAgo.getMinutes())}:${pad(threeHoursAgo.getSeconds())}`;

    const ms = exifViewerLocalTimestamp(wallClock)!;
    expect(ms).toBeLessThan(Date.now());
    expect(Date.now() - ms).toBeGreaterThan(2.5 * 60 * 60 * 1000);
  });

  it("returns null for an unparseable value", () => {
    expect(exifViewerLocalTimestamp("not a date")).toBeNull();
    expect(exifViewerLocalTimestamp(null)).toBeNull();
  });
});

describe("parseExifOffsetMinutes", () => {
  it.each([
    ["+08:00", 480],
    ["+09:00", 540],
    ["-05:00", -300],
    ["+05:30", 330],
    ["+0800", 480],
  ])("reads %s as %i minutes east of UTC", (raw, expected) => {
    expect(parseExifOffsetMinutes(raw)).toBe(expected);
  });

  it.each([[""], ["Z"], ["+8"], ["nonsense"], [null], [undefined]])(
    "returns null for %j",
    (raw) => {
      expect(parseExifOffsetMinutes(raw)).toBeNull();
    },
  );
});

describe("exifInstantTimestamp", () => {
  // The one place OffsetTime is applied: turning a wall clock plus its zone
  // into the real instant, for measuring elapsed time.
  it("recovers the real instant from a wall clock and its offset", () => {
    expect(exifInstantTimestamp("2026:08:01 16:55:08", "+08:00")).toBe(
      Date.parse("2026-08-01T08:55:08Z"),
    );
    expect(exifInstantTimestamp("2026:08:01 16:55:08", "-05:00")).toBe(
      Date.parse("2026-08-01T21:55:08Z"),
    );
  });

  it("is null when the zone is unknown, so callers fall back", () => {
    expect(exifInstantTimestamp("2026:08:01 16:55:08", null)).toBeNull();
    expect(exifInstantTimestamp(null, "+08:00")).toBeNull();
  });
});

describe("exifRelativeTimestamp", () => {
  it("prefers the true instant when the photo records its zone", () => {
    expect(exifRelativeTimestamp("2026:08:01 16:55:08", "+09:00")).toBe(
      exifInstantTimestamp("2026:08:01 16:55:08", "+09:00"),
    );
  });

  it("falls back to the viewer's zone when it does not", () => {
    expect(exifRelativeTimestamp("2026:08:01 16:55:08")).toBe(
      exifViewerLocalTimestamp("2026:08:01 16:55:08"),
    );
  });

  // A photo taken an hour ago in another zone should read as an hour ago,
  // not as an hour plus the difference between the two zones.
  it("measures elapsed time correctly across zones", () => {
    const anHourAgoUtc = new Date(Date.now() - 60 * 60 * 1000);
    const pad = (value: number) => String(value).padStart(2, "0");
    // The same instant, written as a Tokyo wall clock with its offset.
    const tokyo = new Date(anHourAgoUtc.getTime() + 9 * 60 * 60 * 1000);
    const wallClock =
      `${tokyo.getUTCFullYear()}:${pad(tokyo.getUTCMonth() + 1)}:${pad(tokyo.getUTCDate())} ` +
      `${pad(tokyo.getUTCHours())}:${pad(tokyo.getUTCMinutes())}:${pad(tokyo.getUTCSeconds())}`;

    const elapsedMinutes = (Date.now() - exifRelativeTimestamp(wallClock, "+09:00")!) / 60000;
    expect(elapsedMinutes).toBeGreaterThan(59);
    expect(elapsedMinutes).toBeLessThan(61);
  });
});

describe("formatExifOffsetSuffix", () => {
  // Displayed, never applied: a wall clock without its zone is ambiguous across
  // a library spanning several — 15:44 in Tokyo and 15:44 in Istanbul read the
  // same — but shifting the clock by it would move the photo off the hour it
  // was actually taken.
  it.each([
    ["+08:00", " (+08:00)"],
    ["-05:00", " (-05:00)"],
    ["+05:30", " (+05:30)"],
  ])("renders %s as %j", (raw, expected) => {
    expect(formatExifOffsetSuffix(raw)).toBe(expected);
  });

  it.each([[null], [undefined], [""], ["Z"], ["garbage"]])("renders nothing for %j", (raw) => {
    expect(formatExifOffsetSuffix(raw)).toBe("");
  });
});

describe("formatExifWallClockDateTime with a zone", () => {
  it("names the zone beside the time without moving it", () => {
    expect(formatExifWallClockDateTime("2026:08:01 16:55:08", "+08:00")).toBe(
      "1 August 2026 at 16:55 (+08:00)",
    );
  });

  it("shows the same clock unqualified when the zone is unknown", () => {
    expect(formatExifWallClockDateTime("2026:08:01 16:55:08")).toBe("1 August 2026 at 16:55");
  });
});
