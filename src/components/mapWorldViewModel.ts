import { exifWallClockTimestamp, parseExifLocalDateTime } from "../util/exifTime";
import { recencyColor } from "../util/mapColor";
import type { MapWorldEntry, TimeRange } from "./MapWorld";

export type MapBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type PhotoDateStats = {
  oldest: MapWorldEntry | undefined;
  newest: MapWorldEntry | undefined;
  oldestMs: number | null;
  range: number;
};

export type PhotoWithStyle = MapWorldEntry & {
  relative: number;
  markerColor: string;
};

const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const pad2 = (value: number): string => String(value).padStart(2, "0");

export const formatMapPhotoDate = (value: string | null): string | null => {
  const date = parseExifLocalDateTime(value);
  return date ? `${date.day} ${SHORT_MONTH_NAMES[date.month - 1]} ${date.year}` : null;
};

export const formatMapPhotoDateTime = (value: string | null): string | null => {
  const date = parseExifLocalDateTime(value);
  return date
    ? `${date.day} ${SHORT_MONTH_NAMES[date.month - 1]} ${date.year}, ${pad2(date.hour)}:${pad2(date.minute)}`
    : null;
};

export const isPhotoInTimeRange = (
  photo: Pick<MapWorldEntry, "date">,
  range: TimeRange,
): boolean => {
  const ms = exifWallClockTimestamp(photo.date);
  return ms !== null && ms >= range.fromMs && ms <= range.toMs;
};

export const getPhotoDateStats = (photos: MapWorldEntry[]): PhotoDateStats => {
  const dated = photos
    .map((photo) => ({ photo, ms: exifWallClockTimestamp(photo.date) }))
    .filter((entry): entry is { photo: MapWorldEntry; ms: number } => entry.ms !== null)
    .sort((left, right) => left.ms - right.ms);

  const oldestEntry = dated.at(0);
  const newestEntry = dated.at(-1);
  const oldestMs = oldestEntry?.ms ?? null;
  const range = oldestMs === null || !newestEntry ? 0 : newestEntry.ms - oldestMs;

  return {
    oldest: oldestEntry?.photo,
    newest: newestEntry?.photo,
    oldestMs,
    range,
  };
};

export const stylePhotosByRecency = (
  photos: MapWorldEntry[],
  dateStats: PhotoDateStats,
): PhotoWithStyle[] =>
  photos
    .map((photo) => ({ photo, ms: exifWallClockTimestamp(photo.date) }))
    .sort(
      (left, right) =>
        (left.ms ?? Number.NEGATIVE_INFINITY) - (right.ms ?? Number.NEGATIVE_INFINITY),
    )
    .map(({ photo, ms }) => {
      const rawRelative =
        dateStats.range > 0 && ms !== null && dateStats.oldestMs !== null
          ? (ms - dateStats.oldestMs) / dateStats.range
          : 0;
      const relative = Number.isFinite(rawRelative) ? Math.min(1, Math.max(0, rawRelative)) : 0;

      return {
        ...photo,
        relative,
        markerColor: recencyColor(relative),
      };
    });

export const filterPhotosByBounds = (
  photos: PhotoWithStyle[],
  bounds: MapBounds | null,
): PhotoWithStyle[] => {
  if (!bounds) {
    return photos;
  }

  return photos.filter((photo) => {
    if (photo.decLat === null || photo.decLng === null) {
      return false;
    }

    const inLatitude = photo.decLat >= bounds.south && photo.decLat <= bounds.north;
    const inLongitude =
      bounds.west <= bounds.east
        ? photo.decLng >= bounds.west && photo.decLng <= bounds.east
        : photo.decLng >= bounds.west || photo.decLng <= bounds.east;

    return inLatitude && inLongitude;
  });
};

export const getLegendYears = (
  dateStats: Pick<PhotoDateStats, "oldest" | "newest">,
): { older: string; newer: string } => {
  const older = dateStats.oldest?.date?.match(/^\d{4}/)?.[0] ?? null;
  const newer = dateStats.newest?.date?.match(/^\d{4}/)?.[0] ?? null;

  if (!older || !newer || older === newer) {
    return { older: "Older", newer: "Newer" };
  }

  return { older, newer };
};
