import { Content, PhotoBlock } from "../services/types";
import {
  NUMERIC_FACETS,
  STRING_FACETS,
  PhotoFacet,
} from "./photoBuckets";

export type BucketedStat = {
  label: string;
  count: number;
};

export type NumericFacetStat = {
  facetId: string;
  displayName: string;
  data: BucketedStat[];
  /** Fraction 0–1: how many photos had this field vs totalPhotos */
  coverage: number;
};

export type StringFacetStat = {
  facetId: string;
  displayName: string;
  /** Top N by count, descending */
  data: BucketedStat[];
  coverage: number;
};

export type PhotoStats = {
  totalPhotos: number;
  totalAlbums: number;
  /** [earliest year, latest year] inclusive. null if no dated photos. */
  dateRange: [number, number] | null;
  numericFacets: NumericFacetStat[];
  stringFacets: StringFacetStat[];
};

const TOP_N_STRING = 20;

function computeNumericFacet(
  photos: PhotoBlock[],
  facet: PhotoFacet<number>,
): NumericFacetStat {
  const counts = new Map<string, number>(
    facet.buckets.map((b) => [b.label, 0]),
  );
  let withField = 0;

  for (const photo of photos) {
    const value = facet.extract(photo._build.exif, photo._build.tags ?? undefined);
    if (value === null) continue;
    withField++;
    const bucket = facet.buckets.find((b) => b.match(value));
    if (bucket) {
      counts.set(bucket.label, (counts.get(bucket.label) ?? 0) + 1);
    }
  }

  return {
    facetId: facet.id,
    displayName: facet.displayName,
    data: facet.buckets.map((b) => ({
      label: b.label,
      count: counts.get(b.label) ?? 0,
    })),
    coverage: photos.length > 0 ? withField / photos.length : 0,
  };
}

function computeStringFacet(
  photos: PhotoBlock[],
  facet: PhotoFacet<string>,
): StringFacetStat {
  const counts = new Map<string, number>();
  let withField = 0;

  for (const photo of photos) {
    const value = facet.extract(photo._build.exif, photo._build.tags ?? undefined);
    if (value === null) continue;
    withField++;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const sorted: BucketedStat[] = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N_STRING);

  return {
    facetId: facet.id,
    displayName: facet.displayName,
    data: sorted,
    coverage: photos.length > 0 ? withField / photos.length : 0,
  };
}

export function computePhotoStats(albums: Content[]): PhotoStats {
  const photos = albums.flatMap((album) =>
    album.blocks.filter((b): b is PhotoBlock => b.kind === "photo"),
  );

  let minYear = Infinity;
  let maxYear = -Infinity;

  for (const photo of photos) {
    const raw = photo._build?.exif?.DateTimeOriginal;
    if (!raw) continue;
    const year = parseInt(raw.slice(0, 4), 10);
    if (Number.isFinite(year) && year >= 1900 && year <= 2100) {
      if (year < minYear) minYear = year;
      if (year > maxYear) maxYear = year;
    }
  }

  const dateRange: [number, number] | null =
    minYear !== Infinity ? [minYear, maxYear] : null;

  return {
    totalPhotos: photos.length,
    totalAlbums: albums.length,
    dateRange,
    numericFacets: NUMERIC_FACETS.map((f) =>
      computeNumericFacet(photos, f as PhotoFacet<number>),
    ),
    stringFacets: STRING_FACETS.map((f) =>
      computeStringFacet(photos, f as PhotoFacet<string>),
    ),
  };
}
