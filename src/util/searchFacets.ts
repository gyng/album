import { Exif, Tags } from "../services/types";
import {
  ALL_FACETS,
  APERTURE_FACET,
  CAMERA_FACET,
  CITY_FACET,
  FOCAL_LENGTH_35MM_FACET,
  FOCAL_LENGTH_ACTUAL_FACET,
  ISO_FACET,
  LENS_FACET,
  LOCATION_FACET,
  PhotoFacet,
  REGION_FACET,
  SUBREGION_FACET,
} from "./photoBuckets";

export type SearchFacetSelection = {
  facetId: string;
  value: string;
};

const FACET_PARAM = "facet";

const SEARCHABLE_FACET_IDS = new Set([
  FOCAL_LENGTH_35MM_FACET.id,
  FOCAL_LENGTH_ACTUAL_FACET.id,
  APERTURE_FACET.id,
  ISO_FACET.id,
  CAMERA_FACET.id,
  LENS_FACET.id,
  LOCATION_FACET.id,
  REGION_FACET.id,
  SUBREGION_FACET.id,
  CITY_FACET.id,
]);

const getFacetById = (
  facetId: string,
): PhotoFacet<number | string> | undefined => {
  return ALL_FACETS.find((facet) => facet.id === facetId);
};

export const isSearchableFacetId = (facetId: string): boolean => {
  return SEARCHABLE_FACET_IDS.has(facetId);
};

export const normalizeSearchFacetSelection = (
  selection: SearchFacetSelection,
): SearchFacetSelection | null => {
  const facetId = selection.facetId.trim();
  const value = selection.value.trim();
  if (!facetId || !value || !isSearchableFacetId(facetId)) {
    return null;
  }

  return { facetId, value };
};

export const serializeSearchFacetSelection = (
  selection: SearchFacetSelection,
): string => {
  return `${selection.facetId}:${selection.value}`;
};

export const parseSearchFacetSelection = (
  raw: string,
): SearchFacetSelection | null => {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  return normalizeSearchFacetSelection({
    facetId: raw.slice(0, separatorIndex),
    value: raw.slice(separatorIndex + 1),
  });
};

export const dedupeSearchFacetSelections = (
  selections: SearchFacetSelection[],
): SearchFacetSelection[] => {
  const seen = new Set<string>();
  return selections.filter((selection) => {
    const normalized = normalizeSearchFacetSelection(selection);
    if (!normalized) {
      return false;
    }

    const key = serializeSearchFacetSelection(normalized);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

export const readSearchFacetSelections = (
  searchParams: URLSearchParams,
): SearchFacetSelection[] => {
  return dedupeSearchFacetSelections(
    searchParams.getAll(FACET_PARAM).flatMap((raw) => {
      const parsed = parseSearchFacetSelection(raw);
      return parsed ? [parsed] : [];
    }),
  );
};

export const writeSearchFacetSelections = (
  searchParams: URLSearchParams,
  selections: SearchFacetSelection[],
): void => {
  searchParams.delete(FACET_PARAM);
  dedupeSearchFacetSelections(selections).forEach((selection) => {
    searchParams.append(FACET_PARAM, serializeSearchFacetSelection(selection));
  });
};

export const buildSearchHref = (opts?: {
  query?: string[];
  facets?: SearchFacetSelection[];
}): string => {
  const params = new URLSearchParams();
  const query = opts?.query?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (query.length > 0) {
    params.set("q", query.join(","));
  }

  if (opts?.facets?.length) {
    writeSearchFacetSelections(params, opts.facets);
  }

  const queryString = params.toString();
  return queryString ? `/search?${queryString}` : "/search";
};

export const buildSearchFacetHref = (
  selection: SearchFacetSelection,
): string | null => {
  const normalized = normalizeSearchFacetSelection(selection);
  if (!normalized) {
    return null;
  }

  return buildSearchHref({ facets: [normalized] });
};

export const getSearchFacetChipLabel = (
  selection: SearchFacetSelection,
): string => {
  switch (selection.facetId) {
    case ISO_FACET.id:
      return `ISO: ${selection.value}`;
    case APERTURE_FACET.id:
      return `Aperture: ${selection.value}`;
    case FOCAL_LENGTH_35MM_FACET.id:
      return `35mm eq.: ${selection.value}`;
    case FOCAL_LENGTH_ACTUAL_FACET.id:
      return `Focal length: ${selection.value}`;
    case CAMERA_FACET.id:
      return `Camera: ${selection.value}`;
    case LENS_FACET.id:
      return `Lens: ${selection.value}`;
    case LOCATION_FACET.id:
      return `Country: ${selection.value}`;
    case REGION_FACET.id:
      return `Region: ${selection.value}`;
    case SUBREGION_FACET.id:
      return `Subregion: ${selection.value}`;
    case CITY_FACET.id:
      return `City: ${selection.value}`;
    default:
      return selection.value;
  }
};

const getNumericBucketLabel = (
  facet: PhotoFacet<number>,
  value: number | null | undefined,
): string | null => {
  if (value == null) {
    return null;
  }

  return facet.buckets.find((bucket) => bucket.match(value))?.label ?? null;
};

export const getBucketFacetSelection = (
  facetId: string,
  value: number | null | undefined,
): SearchFacetSelection | null => {
  const facet = getFacetById(facetId);
  if (!facet || facet.buckets.length === 0 || !isSearchableFacetId(facetId)) {
    return null;
  }

  const label = getNumericBucketLabel(facet as PhotoFacet<number>, value);
  return label ? { facetId, value: label } : null;
};

export const getCameraFacetSelection = (
  exif: Exif,
): SearchFacetSelection | null => {
  const value = CAMERA_FACET.extract(exif) ?? null;
  return value
    ? normalizeSearchFacetSelection({ facetId: CAMERA_FACET.id, value })
    : null;
};

export const getLensFacetSelection = (
  exif: Exif,
): SearchFacetSelection | null => {
  const value = LENS_FACET.extract(exif) ?? null;
  return value
    ? normalizeSearchFacetSelection({ facetId: LENS_FACET.id, value })
    : null;
};

export const getLocationFacetSelection = (
  tags?: Tags | null,
): SearchFacetSelection | null => {
  const value = LOCATION_FACET.extract({} as Exif, tags ?? undefined) ?? null;
  return value
    ? normalizeSearchFacetSelection({ facetId: LOCATION_FACET.id, value })
    : null;
};
