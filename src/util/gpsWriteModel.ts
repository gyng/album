// Pure model for turning a decimal-degree fix into the EXIF GPS tags exiftool
// writes, plus a diffable write plan. No I/O — the exiftool call lives in
// src/services/geotagWrite.ts.

export type GpsFix = {
  lat: number;
  lng: number;
  /** Metres relative to sea level; negative = below. */
  altitude?: number;
  /** True when the fix came from track interpolation rather than a real reading. */
  interpolated?: boolean;
};

export type ExifGpsTags = {
  GPSLatitude: number; // absolute value; sign carried by the ref
  GPSLatitudeRef: "N" | "S";
  GPSLongitude: number;
  GPSLongitudeRef: "E" | "W";
  GPSAltitude?: number;
  GPSAltitudeRef?: 0 | 1; // 0 = above sea level, 1 = below
  GPSProcessingMethod?: string;
};

export type WriteAssignment = {
  filename: string;
  path: string;
  before: { lat: number; lng: number } | null;
  after: GpsFix;
};

export type WritePlanItem = WriteAssignment & { tags: ExifGpsTags };

export const isValidLat = (value: number): boolean =>
  Number.isFinite(value) && value >= -90 && value <= 90;

export const isValidLng = (value: number): boolean =>
  Number.isFinite(value) && value >= -180 && value <= 180;

export const isValidFix = (fix: GpsFix): boolean => isValidLat(fix.lat) && isValidLng(fix.lng);

export const toExifGpsTags = (fix: GpsFix): ExifGpsTags => {
  if (!isValidFix(fix)) {
    throw new Error(`Invalid GPS fix: lat=${fix.lat}, lng=${fix.lng}`);
  }

  const tags: ExifGpsTags = {
    GPSLatitude: Math.abs(fix.lat),
    GPSLatitudeRef: fix.lat < 0 ? "S" : "N",
    GPSLongitude: Math.abs(fix.lng),
    GPSLongitudeRef: fix.lng < 0 ? "W" : "E",
  };

  if (fix.altitude !== undefined && Number.isFinite(fix.altitude)) {
    tags.GPSAltitude = Math.abs(fix.altitude);
    tags.GPSAltitudeRef = fix.altitude < 0 ? 1 : 0;
  }

  if (fix.interpolated) {
    // A standard marker so a later pass can tell interpolated fixes from real
    // camera readings.
    tags.GPSProcessingMethod = "INTERPOLATED";
  }

  return tags;
};

export const buildWritePlan = (assignments: WriteAssignment[]): WritePlanItem[] =>
  assignments
    .filter((assignment) => isValidFix(assignment.after))
    .map((assignment) => ({ ...assignment, tags: toExifGpsTags(assignment.after) }));
