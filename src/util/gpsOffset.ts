// Timezone reconciliation between camera-local EXIF wall-clock time and UTC GPS
// tracks. EXIF DateTimeOriginal is zone-less local time (see AGENTS.md); a GPS
// track is UTC. To sample a track at a photo's capture instant we must know the
// camera's UTC offset. This module resolves that offset and converts local
// parts to true UTC. Pure — no I/O, no tz-lookup (the caller supplies the IANA
// zone); DST handling uses the built-in Intl database.

export type LocalDateTimeParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type OffsetSource = "exif-offsettime" | "gps-selfcalibration" | "track-timezone" | "manual";

export type ResolvedOffset = { offsetMinutes: number; source: OffsetSource };

const OFFSET_RE = /^([+-])(\d{2}):?(\d{2})?$/;

/** Parse an EXIF/ISO offset ("+08:00", "+0900", "+08", "Z") to signed minutes. */
export const parseExifOffset = (raw: string): number | null => {
  const value = raw?.trim();
  if (!value) return null;
  if (value === "Z" || value === "z") return 0;

  const match = OFFSET_RE.exec(value);
  if (!match) return null;

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  if (hours > 14 || minutes > 59) return null;

  return sign * (hours * 60 + minutes);
};

/** Nominal wall-clock parts as a UTC millisecond count (no offset applied). */
const nominalMs = (parts: LocalDateTimeParts): number =>
  Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

/** Convert zone-less local parts to true UTC ms, given the UTC offset. */
export const localExifToUtc = (parts: LocalDateTimeParts, offsetMinutes: number): number =>
  nominalMs(parts) - offsetMinutes * 60_000;

/**
 * Derive the offset from a photo that has BOTH a local DateTimeOriginal and a
 * UTC GPS fix time (GPSDateStamp + GPSTimeStamp), rounded to the nearest 15 min.
 */
export const deriveOffsetFromGps = (localParts: LocalDateTimeParts, gpsUtcMs: number): number => {
  const rawMinutes = (nominalMs(localParts) - gpsUtcMs) / 60_000;
  return Math.round(rawMinutes / 15) * 15;
};

/** UTC offset in minutes that the given IANA zone was at the given instant (DST-aware). */
export const offsetForZoneAt = (zone: string, utcMs: number): number => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const wall: Record<string, number> = {};
  for (const part of dtf.formatToParts(utcMs)) {
    if (part.type !== "literal") wall[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((asUtc - utcMs) / 60_000);
};

export type ResolveOffsetInputs = {
  /** Raw EXIF OffsetTimeOriginal / OffsetTime, e.g. "+08:00". */
  offsetTimeOriginal?: string;
  /** A photo (this one or a segment neighbour) with local parts + a UTC GPS fix. */
  gps?: { localParts: LocalDateTimeParts; gpsUtcMs: number };
  /** IANA zone from a nearby track point + an instant to evaluate it at. */
  track?: { zone: string; sampleUtcMs: number };
  /** User-entered segment offset. */
  manualMinutes?: number;
};

/**
 * Resolve the best available offset, first hit wins in the documented order:
 * per-photo OffsetTimeOriginal → GPS self-calibration → track-location zone →
 * manual. Returns null if nothing is available.
 */
export const resolveOffset = (inputs: ResolveOffsetInputs): ResolvedOffset | null => {
  const fromExif = inputs.offsetTimeOriginal ? parseExifOffset(inputs.offsetTimeOriginal) : null;
  if (fromExif !== null) {
    return { offsetMinutes: fromExif, source: "exif-offsettime" };
  }

  if (inputs.gps) {
    return {
      offsetMinutes: deriveOffsetFromGps(inputs.gps.localParts, inputs.gps.gpsUtcMs),
      source: "gps-selfcalibration",
    };
  }

  if (inputs.track) {
    return {
      offsetMinutes: offsetForZoneAt(inputs.track.zone, inputs.track.sampleUtcMs),
      source: "track-timezone",
    };
  }

  if (inputs.manualMinutes !== undefined) {
    return { offsetMinutes: inputs.manualMinutes, source: "manual" };
  }

  return null;
};
