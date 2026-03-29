import { Exif, Tags } from "../services/types";
import { parseExifLocalDateTime } from "./exifTime";
import { getGeocodeCountry } from "./geocode";

export type PhotoBucket = {
  label: string;
  match: (value: number | string) => boolean;
  // Numeric range for future SQL facet generation. null = unbounded.
  range?: [number | null, number | null];
};

export type PhotoFacet<T extends number | string> = {
  id: string;
  displayName: string;
  /** Extract the raw value from EXIF/Tags. Returns null if unavailable. */
  extract: (exif: Exif, tags?: Tags) => T | null;
  buckets: PhotoBucket[];
};

// ─── Focal length (35mm equivalent) ────────────────────────────────────────
// Only uses FocalLengthIn35mmFormat — never falls back to actual focal length.

export const FOCAL_LENGTH_35MM_FACET: PhotoFacet<number> = {
  id: "focal-length-35mm",
  displayName: "Focal length (35mm equiv.)",
  extract: (exif) => exif.FocalLengthIn35mmFormat ?? null,
  buckets: [
    { label: "<24mm",    match: (v) => (v as number) < 24,                      range: [null, 23] },
    { label: "24–35mm",  match: (v) => (v as number) >= 24 && (v as number) <= 35, range: [24, 35] },
    { label: "35–50mm",  match: (v) => (v as number) > 35 && (v as number) <= 50,  range: [36, 50] },
    { label: "50–85mm",  match: (v) => (v as number) > 50 && (v as number) <= 85,  range: [51, 85] },
    { label: "85–135mm", match: (v) => (v as number) > 85 && (v as number) <= 135, range: [86, 135] },
    { label: "135mm+",   match: (v) => (v as number) > 135,                     range: [136, null] },
  ],
};

// ─── Focal length (actual) ──────────────────────────────────────────────────
// Only uses FocalLength (physical mm on the lens) — never 35mm-eq.
// Bucket boundaries tuned for APS-C / M43 lens ranges.

export const FOCAL_LENGTH_ACTUAL_FACET: PhotoFacet<number> = {
  id: "focal-length-actual",
  displayName: "Focal length (actual)",
  extract: (exif) => exif.FocalLength ?? null,
  buckets: [
    { label: "<18mm",    match: (v) => (v as number) < 18,                      range: [null, 17] },
    { label: "18–23mm",  match: (v) => (v as number) >= 18 && (v as number) <= 23, range: [18, 23] },
    { label: "23–35mm",  match: (v) => (v as number) > 23 && (v as number) <= 35,  range: [24, 35] },
    { label: "35–56mm",  match: (v) => (v as number) > 35 && (v as number) <= 56,  range: [36, 56] },
    { label: "56–100mm", match: (v) => (v as number) > 56 && (v as number) <= 100, range: [57, 100] },
    { label: "100mm+",   match: (v) => (v as number) > 100,                     range: [101, null] },
  ],
};

// ─── Aperture ───────────────────────────────────────────────────────────────

export const APERTURE_FACET: PhotoFacet<number> = {
  id: "aperture",
  displayName: "Aperture",
  extract: (exif) => exif.FNumber ?? null,
  buckets: [
    { label: "f/1.0–1.8", match: (v) => (v as number) <= 1.8,                                range: [null, 1] },
    { label: "f/2–2.8",   match: (v) => (v as number) > 1.8 && (v as number) <= 2.8,          range: [2, 2] },
    { label: "f/3.5–5.6", match: (v) => (v as number) > 2.8 && (v as number) <= 5.6,          range: [3, 5] },
    { label: "f/8–11",    match: (v) => (v as number) > 5.6 && (v as number) <= 11,            range: [8, 11] },
    { label: "f/16+",     match: (v) => (v as number) > 11,                                   range: [16, null] },
  ],
};

// ─── ISO ────────────────────────────────────────────────────────────────────

export const ISO_FACET: PhotoFacet<number> = {
  id: "iso",
  displayName: "ISO",
  extract: (exif) => exif.ISO ?? null,
  buckets: [
    { label: "≤200",   match: (v) => (v as number) <= 200,                                  range: [null, 200] },
    { label: "400",    match: (v) => (v as number) > 200 && (v as number) <= 400,            range: [201, 400] },
    { label: "800",    match: (v) => (v as number) > 400 && (v as number) <= 800,            range: [401, 800] },
    { label: "1600",   match: (v) => (v as number) > 800 && (v as number) <= 1600,           range: [801, 1600] },
    { label: "3200",   match: (v) => (v as number) > 1600 && (v as number) <= 3200,          range: [1601, 3200] },
    { label: "6400+",  match: (v) => (v as number) > 3200,                                  range: [3201, null] },
  ],
};

// ─── Hour of day ────────────────────────────────────────────────────────────
// 24 raw hours — no bucketing. Extracted from local EXIF time.

// Parses "+09:00" or "-05:30" → offset in fractional hours (e.g. 9, -5.5)
const parseOffsetHours = (offsetTime: string): number | null => {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offsetTime.trim());
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (parseInt(match[2], 10) + parseInt(match[3], 10) / 60);
};

export const HOUR_FACET: PhotoFacet<number> = {
  id: "hour",
  displayName: "Time of day",
  extract: (exif) => {
    // Only extract when OffsetTime is present — older cameras store UTC in
    // DateTimeOriginal without an offset, making the hour unreliable.
    // X-T5 and newer bodies write OffsetTime.
    if (!exif.OffsetTime) return null;

    const dt = parseExifLocalDateTime(exif.DateTimeOriginal);
    if (!dt) return null;

    // exifr with reviveValues:true converts DateTimeOriginal to a JS Date,
    // which JSON.stringify then serialises as UTC (e.g. "2026-02-21T06:35:19.000Z").
    // We detect this by checking for a trailing Z or UTC-looking ISO string,
    // then add the OffsetTime back to recover local hour.
    const raw = exif.DateTimeOriginal ?? "";
    const isUtcIso = raw.endsWith("Z") || raw.includes("T");
    if (isUtcIso) {
      const offsetHours = parseOffsetHours(exif.OffsetTime);
      if (offsetHours === null) return null;
      return ((dt.hour + offsetHours) % 24 + 24) % 24;
    }

    return dt.hour;
  },
  buckets: Array.from({ length: 24 }, (_, h) => ({
    label: `${String(h).padStart(2, "0")}:00`,
    match: (v: number | string) => v === h,
    range: [h, h] as [number, number],
  })),
};

// ─── Camera body ────────────────────────────────────────────────────────────

export const CAMERA_FACET: PhotoFacet<string> = {
  id: "camera",
  displayName: "Camera",
  extract: (exif) => {
    const make = exif.Make?.trim();
    const model = exif.Model?.trim();
    if (!make && !model) return null;
    if (!make) return model!;
    if (!model) return make;
    // Avoid "FUJIFILM FUJIFILM X-T5" — some cameras repeat the brand in the model
    if (model.toLowerCase().startsWith(make.toLowerCase())) return model;
    return `${make} ${model}`;
  },
  buckets: [], // string facet: buckets are built dynamically from data
};

// ─── Lens ───────────────────────────────────────────────────────────────────

export const LENS_FACET: PhotoFacet<string> = {
  id: "lens",
  displayName: "Lens",
  extract: (exif) => exif.LensModel?.trim() ?? null,
  buckets: [], // string facet: buckets are built dynamically from data
};

// ─── Location (by country) ──────────────────────────────────────────────────

export const LOCATION_FACET: PhotoFacet<string> = {
  id: "location",
  displayName: "Location",
  extract: (_exif, tags) => getGeocodeCountry(tags?.geocode) ?? null,
  buckets: [], // string facet: buckets are built dynamically from data
};

// ─── All numeric facets (bucketed) ─────────────────────────────────────────

export const NUMERIC_FACETS: PhotoFacet<number>[] = [
  FOCAL_LENGTH_35MM_FACET,
  FOCAL_LENGTH_ACTUAL_FACET,
  APERTURE_FACET,
  ISO_FACET,
  HOUR_FACET,
];

// ─── All string facets (dynamic top-N) ─────────────────────────────────────

export const STRING_FACETS: PhotoFacet<string>[] = [
  CAMERA_FACET,
  LENS_FACET,
  LOCATION_FACET,
];

export const ALL_FACETS: PhotoFacet<number | string>[] = [
  ...NUMERIC_FACETS,
  ...STRING_FACETS,
];
