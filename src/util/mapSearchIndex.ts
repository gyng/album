import type { Block, PhotoBlock } from "../services/types";

export type MapSearchIndexEntry = [href: string, searchText: string];

export const hasMapCoordinates = (block: Block): block is PhotoBlock => {
  if (block.kind !== "photo") {
    return false;
  }
  const { GPSLongitude, GPSLatitude, GPSLongitudeRef, GPSLatitudeRef } = block._build.exif;
  return Boolean(GPSLongitude && GPSLatitude && GPSLongitudeRef && GPSLatitudeRef);
};

export const getMapPhotoHref = (albumSlug: string, photo: PhotoBlock): string => {
  const filename = photo.data.src.split("/").at(-1)!;
  return `/album/${albumSlug}#${encodeURIComponent(filename)}`;
};

export const buildMapPhotoSearchText = (photo: PhotoBlock): string => {
  const tags = photo._build.tags;
  const rawTags = tags?.tags as unknown;
  const searchableTags = Array.isArray(rawTags)
    ? rawTags.filter((value): value is string => typeof value === "string").join(" ")
    : typeof rawTags === "string"
      ? rawTags
      : null;
  const exif = photo._build.exif;

  return [
    photo.data.title,
    photo.data.kicker,
    photo.data.description,
    searchableTags,
    tags?.alt_text,
    tags?.geocode,
    exif.Model,
    exif.LensModel,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
};

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

export const MAP_SEARCH_INDEX_URL = "/data/map-search-index.json";

export const fetchMapSearchIndex = async (
  fetcher: FetchLike = (input, init) => fetch(input, init),
): Promise<Map<string, string>> => {
  const response = await fetcher(MAP_SEARCH_INDEX_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load map search index (${response.status ?? "unknown"})`);
  }
  const payload = (await response.json()) as { entries?: unknown };
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  return new Map(
    entries.filter(
      (entry): entry is MapSearchIndexEntry =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string",
    ),
  );
};
