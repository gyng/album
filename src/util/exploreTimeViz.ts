import type { PhotoStats } from "./computeStats";

/**
 * Geometry for the two time panels on explore.
 *
 * Both were ranked lists of numbers, and both have a dimension a list throws
 * away: a timezone sits somewhere on the world's clock, and a silence sits
 * somewhere in the archive's own life. These turn the numbers into positions.
 */

/** "+09:00" → 9, "-07:00" → -7, "+05:30" → 5.5. Null when it is not an offset. */
export const parseUtcOffsetHours = (raw: string | null | undefined): number | null => {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec((raw ?? "").trim());
  if (!match) return null;
  const [, sign, hours, minutes] = match;
  const magnitude = Number(hours) + Number(minutes) / 60;
  return sign === "-" ? -magnitude : magnitude;
};

export type ZoneAtOffset = {
  name: string;
  count: number;
  sharePercent: number;
  /** True where this zone also keeps a different offset at another time of year. */
  seasonal: boolean;
};

export type OffsetColumn = {
  hours: number;
  label: string;
  /** 0–100 across the span of offsets the archive actually covers. */
  position: number;
  zones: ZoneAtOffset[];
  count: number;
};

/**
 * The archive's zones laid out along the world's clock.
 *
 * A zone is placed at every offset it keeps, so Melbourne stands in two columns
 * — which is the visible proof that the offset was resolved per photograph from
 * where it was taken rather than assumed once for the place.
 */
export const buildZoneAxis = (zones: PhotoStats["timezoneStats"]["zones"]): OffsetColumn[] => {
  const byOffset = new Map<number, { label: string; zones: ZoneAtOffset[]; count: number }>();

  for (const zone of zones) {
    const offsets = zone.offsets
      .map((offset) => ({ hours: parseUtcOffsetHours(offset), label: offset }))
      .filter((entry): entry is { hours: number; label: string } => entry.hours !== null);

    for (const offset of offsets) {
      const column = byOffset.get(offset.hours) ?? { label: offset.label, zones: [], count: 0 };
      column.zones.push({
        name: zone.name,
        count: zone.count,
        sharePercent: zone.sharePercent,
        seasonal: offsets.length > 1,
      });
      // A zone kept in two offsets is one population of photographs, so its
      // count is not split between them; the column totals are "photographs
      // that were ever on this clock", not a partition of the archive.
      column.count += zone.count;
      byOffset.set(offset.hours, column);
    }
  }

  const hours = Array.from(byOffset.keys()).sort((left, right) => left - right);
  const min = hours[0] ?? 0;
  const max = hours[hours.length - 1] ?? 0;
  const span = max - min;

  return hours.map((hour) => {
    const column = byOffset.get(hour)!;
    return {
      hours: hour,
      label: column.label,
      position: span === 0 ? 50 : ((hour - min) / span) * 100,
      zones: [...column.zones].sort(
        (left, right) => right.count - left.count || left.name.localeCompare(right.name),
      ),
      count: column.count,
    };
  });
};

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
