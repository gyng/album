import { exifWallClockTimestamp } from "../util/exifTime";
import type { MapWorldEntry } from "../util/pageDataTypes";

const EARTH_RADIUS_KM = 6371;
const MAX_DIRECTOR_STOPS = 24;
type LocatedMapWorldEntry = MapWorldEntry & { decLat: number; decLng: number };

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

const distanceKm = (left: LocatedMapWorldEntry, right: LocatedMapWorldEntry): number => {
  const latDelta = radians(right.decLat - left.decLat);
  const lngDelta = radians(right.decLng - left.decLng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(left.decLat)) * Math.cos(radians(right.decLat)) * Math.sin(lngDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const geographicNovelty = (kilometres: number): number =>
  Math.min(1, Math.log1p(kilometres) / Math.log1p(12_000));

/**
 * Build a deterministic tour with useful visual pacing from metadata already
 * present on the map. The current pool may itself be keyword-, album-, date-,
 * or eventually semantic-filtered; the director only decides its order.
 */
export const buildMapDirectorSequence = (
  photos: MapWorldEntry[],
  limit = MAX_DIRECTOR_STOPS,
): MapWorldEntry[] => {
  const candidates = photos.filter(
    (photo): photo is LocatedMapWorldEntry =>
      typeof photo.decLat === "number" && typeof photo.decLng === "number",
  );
  if (candidates.length === 0 || limit <= 0) {
    return [];
  }

  const timestamp = (photo: MapWorldEntry): number =>
    exifWallClockTimestamp(photo.date) ?? Number.NEGATIVE_INFINITY;
  const start = candidates.toSorted(
    (left, right) => timestamp(right) - timestamp(left) || left.href.localeCompare(right.href),
  )[0]!;

  const sequence = [start];
  const used = new Set([start.href]);
  const usedAlbums = new Set([start.album]);
  const targetLength = Math.min(limit, candidates.length);

  while (sequence.length < targetLength) {
    const previous = sequence[sequence.length - 1];
    if (!previous) {
      break;
    }
    let best: LocatedMapWorldEntry | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      if (used.has(candidate.href)) {
        continue;
      }
      const distanceFromPrevious = geographicNovelty(distanceKm(previous, candidate));
      const distanceFromTour = geographicNovelty(
        Math.min(...sequence.map((selected) => distanceKm(selected, candidate))),
      );
      const albumNovelty = usedAlbums.has(candidate.album) ? 0 : 1;
      const previousMs = timestamp(previous);
      const candidateMs = timestamp(candidate);
      const temporalNovelty =
        Number.isFinite(previousMs) && Number.isFinite(candidateMs)
          ? Math.min(1, Math.abs(candidateMs - previousMs) / (1000 * 60 * 60 * 24 * 365 * 4))
          : 0;
      const score =
        distanceFromPrevious * 0.55 +
        distanceFromTour * 0.25 +
        albumNovelty * 0.15 +
        temporalNovelty * 0.05;

      if (score > bestScore || (score === bestScore && candidate.href < best!.href)) {
        best = candidate;
        bestScore = score;
      }
    }

    if (!best) {
      break;
    }
    sequence.push(best);
    used.add(best.href);
    usedAlbums.add(best.album);
  }

  return sequence;
};
