/**
 * Pure utilities for time-range filtering on the map.
 *
 * Every number here is a camera-local wall clock anchored to UTC
 * (`exifWallClockTimestamp`): the extent, the histogram, the thumbs, the
 * filter, the labels and the URL all read the same clock, so none of them
 * moves with the reader's own zone.
 */

import { exifWallClockTimestamp } from "./exifTime";

export type DateExtent = { minMs: number; maxMs: number };

/**
 * Parse a capture time (naive ISO or EXIF `YYYY:MM:DD HH:MM:SS`) to its
 * wall-clock coordinate. Returns null for missing or unparseable values.
 *
 * Not `new Date(value)`: that reads a naive string in the reader's zone, which
 * put the extent eight hours from the filter in UTC+8 and dropped the newest
 * photos as soon as one thumb was dragged.
 */
export const parseTimestampSafe = (value: string | null | undefined): number | null =>
  exifWallClockTimestamp(value);

/**
 * Compute the min/max epoch ms across all entries that have a parseable date.
 * Returns null if fewer than 2 distinct dated entries exist.
 */
export const computeDateExtent = (entries: { date: string | null }[]): DateExtent | null => {
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
  const bins = Array.from({ length: binCount }, () => 0);
  const span = extent.maxMs - extent.minMs;
  if (span === 0) return bins;

  for (const entry of entries) {
    const ms = parseTimestampSafe(entry.date);
    if (ms === null) continue;
    const idx = Math.min(Math.floor(((ms - extent.minMs) / span) * binCount), binCount - 1);
    // invariant: idx is clamped to [0, binCount-1], a valid index of bins
    bins[idx]!++;
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

const DAY_MS = 24 * 60 * 60 * 1000;
const SECOND_MS = 1000;

/**
 * Round a range to whole seconds without changing which photos it holds:
 * capture times have one-second precision, so raising the start and lowering
 * the end to the nearest second moves neither across a photo.
 */
export const snapRangeToSeconds = (
  fromMs: number,
  toMs: number,
): { fromMs: number; toMs: number } => ({
  fromMs: Math.ceil(fromMs / SECOND_MS) * SECOND_MS,
  toMs: Math.floor(toMs / SECOND_MS) * SECOND_MS,
});

/**
 * Format one end of a range for the URL. A bound on a day boundary stays the
 * short `YYYY-MM-DD` older links use; anything inside a day carries its time
 * (`YYYY-MM-DDTHH:MM:SS`, wall clock, no zone), or a range narrower than a day
 * could not survive its own URL.
 */
export const formatRangeParam = (epochMs: number, opts?: { endOfDay?: boolean }): string => {
  const intoDay = ((epochMs % DAY_MS) + DAY_MS) % DAY_MS;
  const onBoundary = opts?.endOfDay ? intoDay >= DAY_MS - SECOND_MS : intoDay === 0;
  const iso = new Date(epochMs).toISOString();
  return onBoundary ? iso.slice(0, 10) : iso.slice(0, 19);
};

/**
 * Parse a range param to epoch ms: `YYYY-MM-DD` (start of day, or its last
 * millisecond with `endOfDay`) or `YYYY-MM-DDTHH:MM:SS`.
 */
export const parseRangeParam = (
  value: string | null,
  opts?: { endOfDay?: boolean },
): number | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    return exifWallClockTimestamp(value);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const suffix = opts?.endOfDay ? "T23:59:59.999Z" : "T00:00:00Z";
  const ms = new Date(`${value}${suffix}`).valueOf();
  return Number.isFinite(ms) ? ms : null;
};
