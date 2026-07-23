import type { MapWorldEntry, TimelineEntry } from "./pageDataTypes";

export type MapWorldEntryRow = [
  album: string,
  src: string,
  srcWidth: number,
  srcHeight: number,
  decLat: number | null,
  decLng: number | null,
  date: string | null,
  href: string,
  placeholderColor: string | null,
];

export type TimelineEntryRow = [
  album: string,
  dateTimeOriginal: string,
  decLat: number | null,
  decLng: number | null,
  geocodeSummary: string | null,
  src: string,
  srcWidth: number,
  srcHeight: number,
  href: string,
  path: string,
  placeholderColor: string,
];

const isGeocodeCoordinate = (line: string) => /^-?\d+(?:\.\d+)?$/.test(line);

export const summariseTimelineGeocode = (geocode?: string | null): string | null => {
  if (!geocode) {
    return null;
  }

  const parts = geocode
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isGeocodeCoordinate(line));

  const first = parts[0];
  if (first === undefined) {
    return null;
  }

  const cleaned = first.length <= 3 && first.toUpperCase() === first ? parts.slice(1) : parts;
  if (cleaned.length === 0) {
    return null;
  }

  const summaryParts = [
    cleaned[0],
    cleaned.length > 2 ? cleaned.at(-2) : null,
    cleaned.at(-1),
  ].filter(Boolean) as string[];

  return summaryParts.filter((part, index) => summaryParts.indexOf(part) === index).join(", ");
};

export const packMapWorldEntry = (entry: MapWorldEntry): MapWorldEntryRow => [
  entry.album,
  entry.src.src,
  entry.src.width,
  entry.src.height,
  entry.decLat,
  entry.decLng,
  entry.date,
  entry.href,
  entry.placeholderColor ?? null,
];

export const unpackMapWorldEntry = (row: MapWorldEntryRow): MapWorldEntry => ({
  album: row[0],
  src: { src: row[1], width: row[2], height: row[3] },
  decLat: row[4],
  decLng: row[5],
  date: row[6],
  href: row[7],
  ...(row[8] === null ? {} : { placeholderColor: row[8] }),
  placeholderWidth: row[2],
  placeholderHeight: row[3],
});

export const packTimelineEntry = (entry: TimelineEntry): TimelineEntryRow => [
  entry.album,
  entry.dateTimeOriginal,
  entry.decLat ?? null,
  entry.decLng ?? null,
  summariseTimelineGeocode(entry.geocode),
  entry.src.src,
  entry.src.width,
  entry.src.height,
  entry.href,
  entry.path,
  entry.placeholderColor,
];

export const unpackTimelineEntry = (row: TimelineEntryRow): TimelineEntry => ({
  album: row[0],
  date: row[1].slice(0, 10),
  dateTimeOriginal: row[1],
  decLat: row[2],
  decLng: row[3],
  geocode: row[4],
  src: { src: row[5], width: row[6], height: row[7] },
  href: row[8],
  path: row[9],
  placeholderColor: row[10],
  placeholderWidth: row[6],
  placeholderHeight: row[7],
});
