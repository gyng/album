/** Pure utilities for time-range filtering on the map. */

export type DateExtent = { minMs: number; maxMs: number };

/**
 * Parse a date string (ISO or EXIF `YYYY:MM:DD HH:MM:SS`) to epoch ms.
 * Returns null for missing or unparseable values.
 */
export const parseTimestampSafe = (
  value: string | null | undefined,
): number | null => {
  if (!value) return null;
  // Normalise EXIF colon-separated dates: "2024:03:22 18:30:00" → "2024-03-22 18:30:00"
  const normalised = value.replace(
    /^(\d{4}):(\d{2}):(\d{2})/,
    "$1-$2-$3",
  );
  const ms = new Date(normalised).valueOf();
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Compute the min/max epoch ms across all entries that have a parseable date.
 * Returns null if fewer than 2 distinct dated entries exist.
 */
export const computeDateExtent = (
  entries: { date: string | null }[],
): DateExtent | null => {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;

  for (const entry of entries) {
    const ms = parseTimestampSafe(entry.date);
    if (ms === null) continue;
    if (ms < min) min = ms;
    if (ms > max) max = ms;
    count++;
  }

  if (count < 2 || min === max) return null;
  return { minMs: min, maxMs: max };
};

/**
 * Divide the extent into `binCount` equal-width buckets and count entries per
 * bin. Returns an array of length `binCount`.
 */
export const computeSparklineBins = (
  entries: { date: string | null }[],
  extent: DateExtent,
  binCount: number,
): number[] => {
  const bins = new Array<number>(binCount).fill(0);
  const span = extent.maxMs - extent.minMs;
  if (span === 0) return bins;

  for (const entry of entries) {
    const ms = parseTimestampSafe(entry.date);
    if (ms === null) continue;
    const idx = Math.min(
      Math.floor(((ms - extent.minMs) / span) * binCount),
      binCount - 1,
    );
    bins[idx]++;
  }

  return bins;
};

/**
 * Convert a normalised position (0–1) within an extent to epoch ms.
 */
export const positionToMs = (position: number, extent: DateExtent): number =>
  extent.minMs + position * (extent.maxMs - extent.minMs);

/**
 * Convert epoch ms to a normalised position (0–1) within an extent.
 */
export const msToPosition = (ms: number, extent: DateExtent): number =>
  (ms - extent.minMs) / (extent.maxMs - extent.minMs);

/**
 * Format epoch ms as `YYYY-MM-DD` (UTC).
 */
export const formatRangeDate = (epochMs: number): string =>
  new Date(epochMs).toISOString().slice(0, 10);

/**
 * Format epoch ms as a short human-readable date, e.g. "22 Mar 2024".
 */
export const formatDisplayDate = (epochMs: number): string => {
  const d = new Date(epochMs);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

/**
 * Parse a `YYYY-MM-DD` range param to epoch ms (start of day UTC).
 */
export const parseRangeParam = (
  value: string | null,
  opts?: { endOfDay?: boolean },
): number | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const suffix = opts?.endOfDay ? "T23:59:59.999Z" : "T00:00:00Z";
  const ms = new Date(`${value}${suffix}`).valueOf();
  return Number.isFinite(ms) ? ms : null;
};
