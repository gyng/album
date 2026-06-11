import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Database } from "@sqlite.org/sqlite-wasm";
import { useDebounce } from "use-debounce";
import { useMemo } from "react";
import {
  fetchColorSimilarResults,
  fetchHybridResults,
  fetchResults,
  fetchSemanticResults,
  fetchSimilarResults,
  PaginatedSearchResult,
} from "./api";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";
import { RGB, rgbToHex } from "../../util/colorDistance";
import { SearchMode, useTextVector } from "./useTextVector";
import { parseSearchTerms, SimilarityOrder } from "./searchUtils";
import { SearchFacetSelection } from "../../util/searchFacets";

type Props = {
  database: Database | null;
  embeddingsDatabase: Database | null;
  searchInputValue: string;
  similarPath: string | null;
  similarityOrder: SimilarityOrder;
  colorSearch: RGB | null;
  colorTolerance: number;
  searchMode: SearchMode;
  selectedFacets: SearchFacetSelection[];
  hasHydratedFromUrl: boolean;
  pageSize?: number;
};

export const useSearchResultsState = ({
  database,
  embeddingsDatabase,
  searchInputValue,
  similarPath,
  similarityOrder,
  colorSearch,
  colorTolerance,
  searchMode,
  selectedFacets,
  hasHydratedFromUrl,
  pageSize = 48,
}: Props) => {
  const [debouncedSearchInputValue] = useDebounce(searchInputValue, 600);
  const [debouncedColorSearch] = useDebounce(colorSearch, 300);
  const [debouncedColorTolerance] = useDebounce(colorTolerance, 400);

  const searchQuery = useMemo(
    () => parseSearchTerms(searchInputValue),
    [searchInputValue],
  );
  const debouncedSearchQuery = useMemo(
    () => parseSearchTerms(debouncedSearchInputValue),
    [debouncedSearchInputValue],
  );
  const isSimilarMode = Boolean(similarPath);
  const isColorMode = Boolean(colorSearch);
  const colorHex = useMemo(
    () => (colorSearch ? rgbToHex(colorSearch) : null),
    [colorSearch],
  );
  const trimmedQuery = debouncedSearchQuery.join(" ").trim();
  const hasSearchQuery = trimmedQuery.length > 0;
  const hasFacetFilters = selectedFacets.length > 0;
  const keywordQuery = debouncedSearchQuery.join("|");
  const needsTextVector =
    !isSimilarMode &&
    hasSearchQuery &&
    searchMode !== "keyword";

  const textVectorState = useTextVector({
    isSimilarMode,
    searchMode,
    needsTextVector,
    trimmedQuery,
  });

  const { textVector, textVectorError, textVectorQuery } = textVectorState;
  const hasVectorDatabase = Boolean(embeddingsDatabase || database);

  const hasCurrentTextVector =
    Boolean(textVector) && textVectorQuery === trimmedQuery;

  // When the embedding model fails, hybrid degrades to a keyword search and
  // pure semantic surfaces the error via a completed (empty) query, rather than
  // leaving the query disabled forever with a blank results area (HIGH-7).
  const textVectorFailed = Boolean(textVectorError);

  const canRunQuery =
    hasHydratedFromUrl &&
    Boolean(database) &&
    ((Boolean(similarPath) && hasVectorDatabase) ||
      (isColorMode && !hasSearchQuery) ||
      (hasSearchQuery &&
        (searchMode === "keyword" ||
          textVectorFailed ||
          (hasVectorDatabase && hasCurrentTextVector))) ||
      (!isSimilarMode && (hasFacetFilters || isColorMode)));

  const similarFilename = similarPath?.split("/").at(-1) ?? null;
  const similarPreviewSrc = similarPath
    ? getResizedAlbumImageSrc(similarPath)
    : null;

  const reactQuery = useInfiniteQuery({
    queryKey: [
      "results",
      {
        database: !!database,
        embeddingsDatabase: !!embeddingsDatabase,
        debouncedSearchQuery,
        similarPath,
        similarityOrder,
        colorSearch: debouncedColorSearch,
        colorTolerance: debouncedColorTolerance,
        searchMode,
        selectedFacets,
        hasTextVector: hasCurrentTextVector,
        textVectorFailed,
      },
    ],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      if (!database) {
        return {
          data: [],
          prev: undefined,
          next: undefined,
        };
      }

      // Pure semantic search with a failed embedding model: complete the query
      // empty so the grid can surface the unavailable-error empty state rather
      // than fall back to unrelated keyword matches (HIGH-7).
      if (
        searchMode === "semantic" &&
        textVectorFailed &&
        !hasCurrentTextVector &&
        !similarPath &&
        !(debouncedColorSearch && !hasSearchQuery)
      ) {
        return {
          data: [],
          prev: undefined,
          next: undefined,
        };
      }

      if (similarPath) {
        return await fetchSimilarResults({
          database,
          embeddingsDatabase,
          path: similarPath,
          similarityOrder,
          pageSize,
          page: pageParam,
        });
      }

      if (debouncedColorSearch && !hasSearchQuery) {
        return await fetchColorSimilarResults({
          database,
          color: debouncedColorSearch,
          pageSize,
          page: pageParam,
          maxDistance: debouncedColorTolerance,
          selectedFacets,
        });
      }

      if (searchMode === "semantic" && textVector && hasCurrentTextVector) {
        return await fetchSemanticResults({
          database,
          embeddingsDatabase,
          textQuery: trimmedQuery,
          textVector,
          pageSize,
          page: pageParam,
          selectedFacets,
          colorSearch: debouncedColorSearch,
          colorTolerance: debouncedColorTolerance,
        });
      }

      if (searchMode === "hybrid" && textVector && hasCurrentTextVector) {
        return await fetchHybridResults({
          database,
          embeddingsDatabase,
          textQuery: trimmedQuery,
          keywordQuery,
          textVector,
          pageSize,
          page: pageParam,
          selectedFacets,
          colorSearch: debouncedColorSearch,
          colorTolerance: debouncedColorTolerance,
        });
      }

      if (!hasSearchQuery && !hasFacetFilters) {
        return {
          data: [],
          prev: undefined,
          next: undefined,
        };
      }

      return await fetchResults({
        database,
        query: keywordQuery,
        pageSize,
        page: pageParam,
        selectedFacets,
        colorSearch: debouncedColorSearch,
        colorTolerance: debouncedColorTolerance,
      });
    },
    initialPageParam: 0,
    enabled: canRunQuery,
    placeholderData: keepPreviousData,
    getPreviousPageParam: (firstPage: PaginatedSearchResult) => {
      return firstPage.prev ?? undefined;
    },
    getNextPageParam: (
      lastPage: PaginatedSearchResult,
      _allPages,
      lastPageParam,
    ) => {
      return (
        lastPage.next ??
        (lastPage.data.length === pageSize ? lastPageParam + 1 : undefined)
      );
    },
  });

  const queryResults = reactQuery.data?.pages.flatMap((page) => page.data);
  const canClear =
    isSimilarMode ||
    isColorMode ||
    searchInputValue.trim() !== "" ||
    hasFacetFilters;

  return {
    ...textVectorState,
    canClear,
    colorHex,
    debouncedSearchQuery,
    hasSearchQuery,
    hasFacetFilters,
    isColorMode,
    isSimilarMode,
    queryResults,
    searchQuery,
    similarFilename,
    similarPreviewSrc,
    trimmedQuery,
    ...reactQuery,
  };
};
