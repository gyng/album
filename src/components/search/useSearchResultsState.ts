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
  /** Ephemeral uploaded/drawn image query. The vector is SigLIP v1-space (the
   *  browser vision encoder), ranked against the DB's v1 image embeddings. */
  imageQuery?: { id: number; vector: number[] | null } | null;
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
  imageQuery = null,
  pageSize = 48,
}: Props) => {
  const [debouncedSearchInputValue] = useDebounce(searchInputValue, 600);
  const [debouncedColorSearch] = useDebounce(colorSearch, 300);
  const [debouncedColorTolerance] = useDebounce(colorTolerance, 400);

  const isColourInputPending =
    (colorSearch === null) !== (debouncedColorSearch === null) ||
    colorSearch?.some((channel, index) => channel !== debouncedColorSearch?.[index]) === true ||
    (colorSearch !== null && colorTolerance !== debouncedColorTolerance);
  const isSearchInputPending =
    searchInputValue !== debouncedSearchInputValue || isColourInputPending;

  const searchQuery = useMemo(() => parseSearchTerms(searchInputValue), [searchInputValue]);
  const debouncedSearchQuery = useMemo(
    () => parseSearchTerms(debouncedSearchInputValue),
    [debouncedSearchInputValue],
  );
  const isSimilarMode = Boolean(similarPath);
  const isColorMode = Boolean(colorSearch);
  const isImageQueryMode = Boolean(imageQuery);
  const hasImageVector = Boolean(imageQuery?.vector);
  const colorHex = useMemo(() => (colorSearch ? rgbToHex(colorSearch) : null), [colorSearch]);
  const trimmedQuery = debouncedSearchQuery.join(" ").trim();
  const hasSearchQuery = trimmedQuery.length > 0;
  const hasFacetFilters = selectedFacets.length > 0;
  const keywordQuery = debouncedSearchQuery.join("|");
  const needsTextVector = !isSimilarMode && hasSearchQuery && searchMode !== "keyword";

  const textVectorState = useTextVector({
    isSimilarMode,
    searchMode,
    needsTextVector,
    trimmedQuery,
  });

  const { textVector, textVectorError, textVectorQuery } = textVectorState;
  // Only the embeddings DB (or its search.sqlite fallback, once loaded) can
  // answer vector queries. The main DB is NOT a stand-in: in a split build it
  // has no `embeddings` table, so treating it as "ready" made cold-cache visitors
  // see a definitive "No results" while the embeddings DB downloaded
  // (HIGH-8). Until it resolves, vector queries stay pending instead.
  const hasVectorDatabase = Boolean(embeddingsDatabase);

  const hasCurrentTextVector = Boolean(textVector) && textVectorQuery === trimmedQuery;

  // When the embedding model fails, hybrid degrades to a keyword search and
  // pure semantic surfaces the error via a completed (empty) query, rather than
  // leaving the query disabled forever with a blank results area (HIGH-7).
  const textVectorFailed = Boolean(textVectorError);

  // The progress indicator flickered off for one painted frame each time the
  // debounce settled on a semantic/hybrid query: `isSearchInputPending` drops in
  // that commit, but the vector-encoding effect only dispatches `vector:start`
  // after paint, so `isTextVectorLoading` was still false in between. Deriving
  // "the settled query still needs a vector it doesn't yet have" during render
  // bridges that gap without depending on effect timing.
  const isTextQueryResolving =
    textVectorState.isTextVectorLoading ||
    (needsTextVector && !hasCurrentTextVector && !textVectorFailed);

  const canRunQuery =
    hasHydratedFromUrl &&
    Boolean(database) &&
    ((hasImageVector && hasVectorDatabase) ||
      (Boolean(similarPath) && hasVectorDatabase) ||
      (isColorMode && !hasSearchQuery) ||
      (hasSearchQuery &&
        (searchMode === "keyword" ||
          textVectorFailed ||
          // Hybrid may run before the embeddings DB finishes downloading: it
          // degrades to keyword-only ranking and re-fuses once vectors arrive.
          (searchMode === "hybrid" && hasCurrentTextVector) ||
          // Pure semantic needs the vector DB — otherwise it stays pending.
          (searchMode === "semantic" && hasVectorDatabase && hasCurrentTextVector))) ||
      (!isSimilarMode && (hasFacetFilters || isColorMode)));

  const similarFilename = similarPath?.split("/").at(-1) ?? null;
  const similarPreviewSrc = similarPath ? getResizedAlbumImageSrc(similarPath) : null;

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
        // The vector itself is 768 floats — key on the query's id instead.
        imageQueryId: imageQuery?.id ?? null,
        hasImageVector,
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

      // The uploaded/drawn image query outranks the other modes: starting one
      // clears text/similar/colour, but a facet OR colour filter can enable the
      // query before the vision model finishes encoding — return an empty page
      // (presented through the shared searching state) rather than falling
      // through to an unrelated keyword/facet search.
      if (imageQuery) {
        if (!imageQuery.vector) {
          return {
            data: [],
            prev: undefined,
            next: undefined,
          };
        }
        return await fetchSemanticResults({
          database,
          embeddingsDatabase,
          textQuery: "image query",
          textVector: imageQuery.vector,
          pageSize,
          page: pageParam,
          selectedFacets,
          colorSearch: debouncedColorSearch,
          colorTolerance: debouncedColorTolerance,
        });
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
    getNextPageParam: (lastPage: PaginatedSearchResult) => {
      // Trust the `next` each fetcher computes. The vector/colour paths know the
      // full result count and correctly return `undefined` at an exact-multiple
      // boundary; the old fallback fabricated a phantom "More…" page whenever the
      // last page happened to be full (L3). exec now sets `next` from page 0 too.
      return lastPage.next ?? undefined;
    },
  });

  const queryResults = reactQuery.data?.pages.flatMap((page) => page.data);
  const canClear =
    isSimilarMode ||
    isColorMode ||
    isImageQueryMode ||
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
    isImageQueryMode,
    isSearchInputPending,
    isSimilarMode,
    isTextQueryResolving,
    queryResults,
    searchQuery,
    similarFilename,
    similarPreviewSrc,
    trimmedQuery,
    ...reactQuery,
  };
};
