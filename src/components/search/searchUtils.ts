import { RGB } from "../../util/colorDistance";
import { SearchMode } from "./useTextVector";

export type Tag = {
  name: string;
  count: number;
};

export type InitialSearchState = {
  searchQuery: string[];
  similarPath: string | null;
  colorSearch: RGB | null;
  searchMode: SearchMode;
  hasHydratedFromUrl: boolean;
};

export const DEFAULT_SEARCH_MODE: SearchMode = "hybrid";

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
      colorSearch: null,
      searchMode: DEFAULT_SEARCH_MODE,
      hasHydratedFromUrl: false,
    };
  }

  const url = new URL(window.location.toString());
  const query = url.searchParams.get("q");
  return {
    searchQuery: query ? query.split(",").map((value) => value.trim()) : [],
    similarPath: url.searchParams.get("similar"),
    colorSearch: parseColorParam(url.searchParams.get("color")),
    searchMode: isSearchMode(url.searchParams.get("mode"))
      ? (url.searchParams.get("mode") as SearchMode)
      : DEFAULT_SEARCH_MODE,
    hasHydratedFromUrl: true,
  };
};
