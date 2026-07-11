// Client-side track parsing + interpolation, built entirely on the shared
// src/util modules. tz-lookup is the only server round-trip (fetchTz).
import { parseGpx, parseGoogleTakeout, sampleTrackAt, type Track } from "@shared/gpsTrack";
import { localExifToUtc, parseExifOffset, resolveOffset, type ResolvedOffset } from "@shared/gpsOffset";
import { parseExifLocalDateTime } from "@shared/exifTime";
import { fetchTz, type GeotagPhoto, type PendingFix } from "./api.ts";

export type TrackFormat = "gpx" | "takeout";

export const parseTrackFile = (text: string, format: TrackFormat): Track =>
  format === "gpx" ? parseGpx(text) : parseGoogleTakeout(text);

export const trackFormatFor = (filename: string): TrackFormat =>
  filename.toLowerCase().endsWith(".gpx") ? "gpx" : "takeout";

/**
 * Interpolate a fix for every photo whose capture time falls within the track's
 * span. Per-photo OffsetTimeOriginal wins over the segment offset.
 */
export const interpolatePhotos = (
  photos: GeotagPhoto[],
  track: Track,
  segmentOffsetMinutes: number,
): Record<string, PendingFix> => {
  const out: Record<string, PendingFix> = {};
  for (const photo of photos) {
    const parts = parseExifLocalDateTime(photo.dateTimeOriginal);
    if (!parts) continue;
    const perPhoto = photo.offsetTimeOriginal ? parseExifOffset(photo.offsetTimeOriginal) : null;
    const offset = perPhoto ?? segmentOffsetMinutes;
    const sample = sampleTrackAt(track, localExifToUtc(parts, offset));
    if (sample) {
      out[photo.filename] = {
        lat: sample.lat,
        lng: sample.lng,
        confidence: sample.confidence,
        interpolated: true,
      };
    }
  }
  return out;
};

/** Suggest a segment UTC offset from the photos + track (the gpsOffset ladder). */
export const suggestSegmentOffset = async (
  photos: GeotagPhoto[],
  track: Track,
): Promise<ResolvedOffset | null> => {
  const withOffset = photos.find(
    (p) => p.offsetTimeOriginal && parseExifOffset(p.offsetTimeOriginal) !== null,
  );
  const withGps = photos.find(
    (p) => p.gpsUtcMs !== null && parseExifLocalDateTime(p.dateTimeOriginal) !== null,
  );

  let trackInput: { zone: string; sampleUtcMs: number } | undefined;
  if (track.points.length > 0) {
    const mid = track.points[Math.floor(track.points.length / 2)];
    const zone = await fetchTz(mid.lat, mid.lng);
    if (zone) trackInput = { zone, sampleUtcMs: mid.utcMs };
  }

  return resolveOffset({
    offsetTimeOriginal: withOffset?.offsetTimeOriginal ?? undefined,
    gps: withGps
      ? { localParts: parseExifLocalDateTime(withGps.dateTimeOriginal)!, gpsUtcMs: withGps.gpsUtcMs! }
      : undefined,
    track: trackInput,
  });
};
