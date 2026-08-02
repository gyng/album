// EXIF DateTimeOriginal is typically "YYYY:MM:DD HH:MM:SS"
// (colon-separated date, space, colon-separated time).
// Some cameras emit ISO-like "YYYY-MM-DDTHH:MM:SS" or "YYYY-MM-DD HH:MM:SS".
// We parse deliberately with regex — never via new Date() — to preserve local time.
// new Date("2024:03:22 18:30:00") would apply TZ conversion and give wrong hours.

export type ExifLocalDateTime = {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  hour: number; // 0–23
  minute: number;
  second: number;
};

// Matches "YYYY:MM:DD HH:MM:SS" (EXIF) and "YYYY-MM-DDTHH:MM:SS" / "YYYY-MM-DD HH:MM:SS" (ISO-like)
// Date separator must be uniform: all colons OR all dashes, not mixed or slashes.
const EXIF_DT_RE = /^(\d{4})([-:])(\d{2})\2(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;

export function parseExifLocalDateTime(raw: string | undefined | null): ExifLocalDateTime | null {
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
    year < 1900 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  return { year, month, day, hour, minute, second };
}

const pad2 = (value: number) => String(value).padStart(2, "0");

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// Naive ISO ("YYYY-MM-DDTHH:MM:SS", no zone designator) is the repo-wide
// serialisation for EXIF timestamps: it preserves the camera's wall clock
// exactly, so day/hour/year derivations are identical on every machine.
export function formatExifWallClockIso(dt: ExifLocalDateTime): string {
  return (
    `${dt.year}-${pad2(dt.month)}-${pad2(dt.day)}` +
    `T${pad2(dt.hour)}:${pad2(dt.minute)}:${pad2(dt.second)}`
  );
}

export function normaliseExifWallClockIso(raw: string | undefined | null): string | null {
  const dt = parseExifLocalDateTime(raw);
  return dt ? formatExifWallClockIso(dt) : null;
}

// A nominal numeric value for ordering photos and measuring the span between
// two of them. Date.UTC is used only as a stable coordinate system for the
// already-parsed wall-clock components: it does not convert the camera time or
// apply OffsetTime, and the choice of zone cancels out when two of these are
// subtracted.
//
// Not comparable with `Date.now()`. Use `exifViewerLocalTimestamp` for that.
export function exifWallClockTimestamp(raw: string | undefined | null): number | null {
  const dt = parseExifLocalDateTime(raw);
  if (!dt) return null;

  return Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second);
}

/**
 * The same wall clock, placed in the *viewer's* zone. The fallback for relative
 * labels when the photo's own zone is unknown — exact when the reader is in the
 * zone the photo was taken in, and out by the difference otherwise.
 *
 * `exifWallClockTimestamp` anchors to UTC, which is right for ordering and for
 * differences between two photos but wrong here — mixing a UTC-anchored wall
 * clock with `Date.now()` shifts the result by the viewer's own offset, so a
 * photo taken at 16:55 in UTC+8 read as taken nine minutes in the future.
 *
 * Only relative labels should use this. Anything that buckets or sorts must
 * keep the fixed zone, or the same photo lands on different days for different
 * readers.
 */
export function exifViewerLocalTimestamp(raw: string | undefined | null): number | null {
  const dt = parseExifLocalDateTime(raw);
  if (!dt) return null;

  return new Date(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second).getTime();
}

/** Minutes east of UTC from an EXIF `OffsetTime` such as "+08:00" or "-05:00". */
export function parseExifOffsetMinutes(raw: string | undefined | null): number | null {
  if (!raw) return null;

  const match = raw.trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match) return null;

  const [, sign, hours, minutes] = match;
  const total = Number(hours) * 60 + Number(minutes);
  return Number.isNaN(total) ? null : sign === "-" ? -total : total;
}

/**
 * The real instant the shutter fired, for the one case that needs it: measuring
 * elapsed time against `Date.now()`.
 *
 * This is the sole place `OffsetTime` is applied. Everywhere else it is only a
 * label naming the zone the wall clock is already in — shifting a *displayed*
 * time by it would move a photo off the hour it was actually taken. Converting
 * to an instant is the opposite operation and changes no displayed clock.
 *
 * Null when either the wall clock or the offset is missing; around 44% of this
 * library has no `OffsetTime`, so callers need the viewer-local fallback.
 */
export function exifInstantTimestamp(
  raw: string | undefined | null,
  offsetRaw: string | undefined | null,
): number | null {
  const dt = parseExifLocalDateTime(raw);
  const offsetMinutes = parseExifOffsetMinutes(offsetRaw);
  if (!dt || offsetMinutes === null) return null;

  const asIfUtc = Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second);
  return asIfUtc - offsetMinutes * 60_000;
}

/**
 * Best available basis for "3 hours ago": the true instant where the photo
 * records its zone, the viewer's own zone otherwise. The single entry point for
 * relative labels — nothing else should choose between the two.
 */
export function exifRelativeTimestamp(
  raw: string | undefined | null,
  offsetRaw?: string | null,
): number | null {
  return exifInstantTimestamp(raw, offsetRaw) ?? exifViewerLocalTimestamp(raw);
}

export function formatExifWallClockDate(raw: string | undefined | null): string | null {
  const dt = parseExifLocalDateTime(raw);
  if (!dt) return null;

  return `${dt.day} ${MONTH_NAMES[dt.month - 1]} ${dt.year}`;
}

/**
 * The offset as a display suffix, or "" when the photo did not record one.
 *
 * Shown rather than applied. A wall clock without its zone is ambiguous across
 * a library that spans several — 15:44 in Tokyo and 15:44 in Istanbul read
 * identically — so the zone is named beside the time it belongs to.
 */
export function formatExifOffsetSuffix(offsetRaw: string | undefined | null): string {
  return parseExifOffsetMinutes(offsetRaw) === null ? "" : ` (${offsetRaw!.trim()})`;
}

export function formatExifWallClockDateTime(
  raw: string | undefined | null,
  offsetRaw?: string | null,
): string | null {
  const dt = parseExifLocalDateTime(raw);
  if (!dt) return null;

  return (
    `${dt.day} ${MONTH_NAMES[dt.month - 1]} ${dt.year} at ${pad2(dt.hour)}:${pad2(dt.minute)}` +
    formatExifOffsetSuffix(offsetRaw)
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
