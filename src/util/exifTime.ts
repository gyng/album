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

const pad2 = (value: number) => String(value).padStart(2, "0");

// Naive ISO ("YYYY-MM-DDTHH:MM:SS", no zone designator) is the repo-wide
// serialisation for EXIF timestamps: it preserves the camera's wall clock
// exactly, so day/hour/year derivations are identical on every machine.
export function formatExifWallClockIso(dt: ExifLocalDateTime): string {
  return (
    `${dt.year}-${pad2(dt.month)}-${pad2(dt.day)}` +
    `T${pad2(dt.hour)}:${pad2(dt.minute)}:${pad2(dt.second)}`
  );
}

// Wall-clock calendar day ("YYYY-MM-DD") from any EXIF-ish timestamp string.
export function exifDayKey(raw: string | undefined | null): string | null {
  const dt = parseExifLocalDateTime(raw);
  return dt ? `${dt.year}-${pad2(dt.month)}-${pad2(dt.day)}` : null;
}

// Serialises a Date via its *local* components. exifr (reviveValues) parses
// EXIF wall-clock time into a Date in the current machine's zone; reading the
// local components back recovers the original wall clock exactly, so the
// result is machine-independent. (toISOString would instead shift the wall
// clock by the machine's UTC offset.)
export function dateToNaiveIso(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}
