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
    !isColorMode &&
    hasSearchQuery &&
    searchMode !== "keyword";

  const textVectorState = useTextVector({
    isSimilarMode,
    searchMode,
    needsTextVector,
    trimmedQuery,
  });

  const { textVector, textVectorQuery } = textVectorState;
  const hasVectorDatabase = Boolean(embeddingsDatabase || database);

  const hasCurrentTextVector =
    Boolean(textVector) && textVectorQuery === trimmedQuery;

  const canRunQuery =
    hasHydratedFromUrl &&
    Boolean(database) &&
    ((Boolean(similarPath) && hasVectorDatabase) ||
      isColorMode ||
      (hasSearchQuery &&
        (searchMode === "keyword" ||
          (hasVectorDatabase && hasCurrentTextVector))) ||
      (!isSimilarMode && !isColorMode && hasFacetFilters));

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

      if (debouncedColorSearch) {
        return await fetchColorSimilarResults({
          database,
          color: debouncedColorSearch,
          pageSize,
          page: pageParam,
          maxDistance: debouncedColorTolerance,
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
    isSimilarMode || isColorMode || searchInputValue.trim() !== "";

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
