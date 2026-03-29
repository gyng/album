import { RGB } from "../../util/colorDistance";
import { SearchMode } from "./useTextVector";
import {
  readSearchFacetSelections,
  SearchFacetSelection,
} from "../../util/searchFacets";

export type Tag = {
  name: string;
  count: number;
};

export type InitialSearchState = {
  searchQuery: string[];
  similarPath: string | null;
  similarityOrder: SimilarityOrder;
  colorSearch: RGB | null;
  searchMode: SearchMode;
  selectedFacets: SearchFacetSelection[];
  hasHydratedFromUrl: boolean;
};

export const DEFAULT_SEARCH_MODE: SearchMode = "hybrid";
export type SimilarityOrder = "most" | "least";
export const DEFAULT_SIMILARITY_ORDER: SimilarityOrder = "most";

export const similarSearchEmojiStyle = {
  filter: "grayscale(100%)",
} as const;

export const forceDocumentNavigation = (
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string,
) => {
  event.preventDefault();
  window.location.assign(href);
};

export const dedupeTags = (tags: Tag[]): Tag[] => {
  return Object.values(
    tags.reduce(
      (acc, tag) => {
        const key = tag.name.toLocaleLowerCase();
        if (!acc[key]) {
          acc[key] = { ...tag, name: key };
        } else {
          acc[key].count += tag.count;
        }
        return acc;
      },
      {} as Record<string, Tag>,
    ),
  );
};

export const parseSearchTerms = (value: string): string[] => {
  if (value === "") {
    return [];
  }

  return value.split(",");
};

export const isSearchMode = (value: string | null): value is SearchMode => {
  return value === "keyword" || value === "semantic" || value === "hybrid";
};

export const isSimilarityOrder = (
  value: string | null,
): value is SimilarityOrder => {
  return value === "most" || value === "least";
};

export const parseColorParam = (value: string | null): RGB | null => {
  if (!value) return null;
  const parts = value.split(",").map((v) => parseInt(v.trim(), 10));
  if (
    parts.length === 3 &&
    parts.every((v) => !isNaN(v) && v >= 0 && v <= 255)
  ) {
    return [parts[0], parts[1], parts[2]];
  }
  return null;
};

export const getInitialSearchState = (): InitialSearchState => {
  if (typeof window === "undefined") {
    return {
      searchQuery: [],
      similarPath: null,
      similarityOrder: DEFAULT_SIMILARITY_ORDER,
      colorSearch: null,
      searchMode: DEFAULT_SEARCH_MODE,
      selectedFacets: [],
      hasHydratedFromUrl: false,
    };
  }

  const url = new URL(window.location.toString());
  const query = url.searchParams.get("q");
  return {
    searchQuery: query ? query.split(",").map((value) => value.trim()) : [],
    similarPath: url.searchParams.get("similar"),
    similarityOrder: isSimilarityOrder(url.searchParams.get("similar_order"))
      ? (url.searchParams.get("similar_order") as SimilarityOrder)
      : DEFAULT_SIMILARITY_ORDER,
    colorSearch: parseColorParam(url.searchParams.get("color")),
    searchMode: isSearchMode(url.searchParams.get("mode"))
      ? (url.searchParams.get("mode") as SearchMode)
      : DEFAULT_SEARCH_MODE,
    selectedFacets: readSearchFacetSelections(url.searchParams),
    hasHydratedFromUrl: true,
  };
};
