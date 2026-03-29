import { parseExifLocalDateTime } from "./exifTime";

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
