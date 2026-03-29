// EXIF DateTimeOriginal is typically "YYYY:MM:DD HH:MM:SS"
// (colon-separated date, space, colon-separated time).
// Some cameras emit ISO-like "YYYY-MM-DDTHH:MM:SS" or "YYYY-MM-DD HH:MM:SS".
// We parse deliberately with regex — never via new Date() — to preserve local time.
// new Date("2024:03:22 18:30:00") would apply TZ conversion and give wrong hours.

export type ExifLocalDateTime = {
  year: number;
  month: number; // 1–12
  day: number;   // 1–31
  hour: number;  // 0–23
  minute: number;
  second: number;
};

// Matches "YYYY:MM:DD HH:MM:SS" (EXIF) and "YYYY-MM-DDTHH:MM:SS" / "YYYY-MM-DD HH:MM:SS" (ISO-like)
// Date separator must be uniform: all colons OR all dashes, not mixed or slashes.
const EXIF_DT_RE =
  /^(\d{4})([-:])(\d{2})\2(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;

export function parseExifLocalDateTime(
  raw: string | undefined | null,
): ExifLocalDateTime | null {
  if (!raw) return null;

  const match = EXIF_DT_RE.exec(raw.trim());
  if (!match) return null;

  const [, y, , mo, d, h, mi, s] = match; // group 2 is the separator backreference
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);

  // Sanity-check — reject obviously invalid values
  if (
    year < 1900 || year > 2100 ||
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59
  ) {
    return null;
  }

  return { year, month, day, hour, minute, second };
}
