import type { PhotoStats } from "./computeStats";

/**
 * Geometry for the silences panel on explore.
 *
 * It was a ranked list of numbers, and a silence has a dimension a list throws
 * away: it sits somewhere in the archive's own life. This turns the numbers
 * into positions.
 */

/** A calendar day as a fractional year, so a silence can be placed to the day. */
export const fractionalYear = (iso: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const start = Date.UTC(Number(year), 0, 1);
  const next = Date.UTC(Number(year) + 1, 0, 1);
  const at = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number(year) + (at - start) / (next - start);
};

export type SilenceBand = {
  days: number;
  fromDate: string;
  toDate: string;
  /** 0–100 across the archive's whole life. */
  start: number;
  width: number;
};

/**
 * The silences placed on the archive's own life, rather than ranked by length.
 *
 * "3.4 years" says how long; where it sits says which years of this archive
 * were quiet, which is the part a list cannot show.
 */
export const buildSilenceBands = (
  gaps: PhotoStats["archiveGaps"],
  dateRange: PhotoStats["dateRange"],
): SilenceBand[] => {
  if (!dateRange) return [];
  const [firstYear, lastYear] = dateRange;
  // The range is inclusive years, so the track runs to the end of the last one.
  const start = firstYear;
  const end = lastYear + 1;
  const span = end - start;
  if (span <= 0) return [];

  return gaps.flatMap((gap) => {
    const from = fractionalYear(gap.fromDate);
    const to = fractionalYear(gap.toDate);
    if (from === null || to === null) return [];

    const left = Math.max(0, ((from - start) / span) * 100);
    const right = Math.min(100, ((to - start) / span) * 100);
    return [
      {
        days: gap.days,
        fromDate: gap.fromDate,
        toDate: gap.toDate,
        start: left,
        width: Math.max(0, right - left),
      },
    ];
  });
};
