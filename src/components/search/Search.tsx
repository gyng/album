import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchRandomPhoto, fetchRefinementTagCounts, fetchTags } from "./api";
import { RGB } from "../../util/colorDistance";
import styles from "./Search.module.css";
import {
  useDatabase,
  useEmbeddingsDatabase,
} from "../database/useDatabase";
import { ProgressBar } from "../ProgressBar";
import { EmptyStateExplore } from "./EmptyStateExplore";
import { SearchInputBar } from "./SearchInputBar";
import { SearchRefinementSection } from "./SearchRefinementSection";
import { SearchResultsGrid } from "./SearchResultsGrid";
import { SimilarTrailBar, SimilarTrailItem } from "./SimilarTrailBar";
import {
  DEFAULT_SEARCH_MODE,
  dedupeTags,
  getInitialSearchState,
  parseSearchTerms,
  Tag,
} from "./searchUtils";
import { SearchMode } from "./useTextVector";
import { useSearchResultsState } from "./useSearchResultsState";

const useSafeLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export type SearchNavState = {
  databaseReady: boolean;
  isRandomSimilarLoading: boolean;
  onStartRandomSimilarSlideshow: () => void;
  randomExploreError: string | null;
};

export const Search: React.FC<{
  disabled?: boolean;
  onNavStateChange?: (state: SearchNavState) => void;
}> = ({ disabled, onNavStateChange }) => {
  const [searchInputValue, setSearchInputValue] = useState<string>("");
  const [searchMode, setSearchMode] = useState<SearchMode>(DEFAULT_SEARCH_MODE);
  const [similarPath, setSimilarPath] = useState<string | null>(null);
  const [colorSearch, setColorSearch] = useState<RGB | null>(null);
  const [colorTolerance, setColorTolerance] = useState<number>(35);
  const [similarTrail, setSimilarTrail] = useState<SimilarTrailItem[]>([]);
  const [hasHydratedFromUrl, setHasHydratedFromUrl] = useState<boolean>(false);
  const [isRandomSimilarLoading, setIsRandomSimilarLoading] =
    useState<boolean>(false);
  const [randomExploreError, setRandomExploreError] = useState<string | null>(
    null,
  );
  const [tags, setTags] = useState<Tag[]>([]);
  const [refinementCounts, setRefinementCounts] = useState<
    Record<string, number>
  >({});
  const inputRef = useRef<HTMLInputElement>(null);
  const modeSourceRef = useRef<HTMLDivElement | null>(null);
  const [database, progress, databaseProgressDetails] = useDatabase();
  const needsEmbeddingsDatabase =
    Boolean(similarPath) ||
    (!colorSearch &&
      searchInputValue.trim() !== "" &&
      searchMode !== "keyword");
  const [
    embeddingsDatabase,
    embeddingsProgress,
    embeddingsProgressDetails,
    embeddingsError,
  ] = useEmbeddingsDatabase(needsEmbeddingsDatabase);

  const {
    canClear,
    colorHex,
    debouncedSearchQuery,
    fetchNextPage,
    hasNextPage,
    isColorMode,
    isFetching,
    isPlaceholderData,
    isSimilarMode,
    isSuccess,
    queryResults,
    searchQuery,
    similarFilename,
    similarPreviewSrc,
    textModelProgress,
    textModelProgressDetails,
    textModelStage,
    textVectorError,
    trimmedQuery,
  } = useSearchResultsState({
    database,
    embeddingsDatabase,
    searchInputValue,
    similarPath,
    colorSearch,
    colorTolerance,
    searchMode,
    hasHydratedFromUrl,
  });

  const normalizedTags = useMemo(() => dedupeTags(tags), [tags]);
  const normalizedSearchTerms = useMemo(
    () => searchQuery.map((term) => term.trim().toLowerCase()).filter(Boolean),
    [searchQuery],
  );
  const normalizedDebouncedSearchTerms = useMemo(
    () =>
      debouncedSearchQuery
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean),
    [debouncedSearchQuery],
  );
  const normalizedTagNames = useMemo(
    () => normalizedTags.map((tag) => tag.name),
    [normalizedTags],
  );

  const similarClickstreamPaths = new Set([
    ...similarTrail.map((item) => item.path),
    ...(similarPath ? [similarPath] : []),
  ]);
  const isEmptyState =
    !isSimilarMode && !isColorMode && searchInputValue.trim() === "";

  useEffect(() => {
    const initialSearchState = getInitialSearchState();
    setSearchInputValue(initialSearchState.searchQuery.join(","));
    setSimilarPath(initialSearchState.similarPath);
    setColorSearch(initialSearchState.colorSearch);
    setSearchMode(initialSearchState.searchMode);
    setHasHydratedFromUrl(initialSearchState.hasHydratedFromUrl);
  }, []);

  useEffect(() => {
    if (!hasHydratedFromUrl) {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    searchParams.delete("q");
    searchParams.delete("similar");
    searchParams.delete("color");
    searchParams.delete("mode");

    if (similarPath) {
      searchParams.set("similar", similarPath);
    } else if (colorSearch) {
      searchParams.set(
        "color",
        `${colorSearch[0]},${colorSearch[1]},${colorSearch[2]}`,
      );
    } else if (debouncedSearchQuery.length > 0) {
      searchParams.set("q", debouncedSearchQuery.join(","));
    }

    if (searchMode !== DEFAULT_SEARCH_MODE) {
      searchParams.set("mode", searchMode);
    }

    const url = new URL(window.location.toString());
    url.search = searchParams.toString();
    const nextRoute = `${url.pathname}${url.search}${url.hash}`;
    const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextRoute === currentRoute) {
      return;
    }

    try {
      window.history.replaceState(window.history.state, "", nextRoute);
    } catch (err) {
      console.warn("Failed to sync search URL", err);
    }
  }, [
    colorSearch,
    debouncedSearchQuery,
    hasHydratedFromUrl,
    searchMode,
    similarPath,
  ]);

  useEffect(() => {
    function handler(ev: KeyboardEvent) {
      if (ev.key === "/") {
        inputRef.current?.focus();
        ev.preventDefault();
      }

      if (ev.key === "Escape") {
        inputRef.current?.blur();
      }

      if (ev.key === "Tab") {
        return true;
      }
    }
    window.addEventListener("keydown", handler);

    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, []);

  useEffect(() => {
    if (!database) {
      return;
    }

    fetchTags({ database, page: 0, pageSize: 1000, minCount: 1 })
      .then((results) => {
        setTags(
          results.data
            .map((r) => ({ name: r.tag, count: r.count }))
            .filter((t) => t.name.length >= 3),
        );
      })
      .catch(console.error);
  }, [database]);

  useEffect(() => {
    if (
      !database ||
      isSimilarMode ||
      isColorMode ||
      normalizedDebouncedSearchTerms.length === 0
    ) {
      setRefinementCounts({});
      return;
    }

    let didCancel = false;

    fetchRefinementTagCounts({
      database,
      activeTerms: normalizedDebouncedSearchTerms,
      candidateTags: normalizedTagNames,
    })
      .then((counts) => {
        if (!didCancel) {
          setRefinementCounts(counts);
        }
      })
      .catch((err) => {
        if (!didCancel) {
          console.error("Failed to fetch refinement tag counts", err);
          setRefinementCounts({});
        }
      });

    return () => {
      didCancel = true;
    };
  }, [
    database,
    isSimilarMode,
    isColorMode,
    normalizedDebouncedSearchTerms,
    normalizedTagNames,
  ]);

  useSafeLayoutEffect(() => {
    if (!similarPath && !isColorMode) {
      return;
    }

    const element = modeSourceRef.current;

    if (!element) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    element.style.transition = "none";
    element.style.transform = "translate3d(0, 14px, 0)";
    element.style.opacity = "0";
    void element.getBoundingClientRect();

    let frameA = 0;
    let frameB = 0;

    frameA = requestAnimationFrame(() => {
      frameB = requestAnimationFrame(() => {
        element.style.removeProperty("transition");
        element.style.transform = "translate3d(0, 0, 0)";
        element.style.opacity = "1";
      });
    });

    return () => {
      cancelAnimationFrame(frameA);
      cancelAnimationFrame(frameB);
    };
  }, [similarPath, isColorMode]);

  const applySearchTerms = useCallback((terms: string[]) => {
    setSimilarPath(null);
    setSimilarTrail([]);
    setColorSearch(null);
    setRandomExploreError(null);
    setSearchInputValue(terms.join(","));
  }, []);

  const clearSearchState = useCallback(() => {
    setSearchInputValue("");
    setSimilarPath(null);
    setSimilarTrail([]);
    setColorSearch(null);
  }, []);

  const truncateSimilarStack = useCallback((breadcrumbIndex: number) => {
    setSimilarTrail((prev) => {
      const nextCurrentPath =
        breadcrumbIndex > 0 ? (prev[breadcrumbIndex - 1]?.path ?? null) : null;
      setSimilarPath(nextCurrentPath);
      return breadcrumbIndex > 1 ? prev.slice(0, breadcrumbIndex - 1) : [];
    });
  }, []);

  const startSimilarSearch = useCallback(
    (path: string) => {
      clearSearchState();
      setSimilarPath(path);
    },
    [clearSearchState],
  );

  const loadRandomSimilarTrail = useCallback(async () => {
    if (!database || isRandomSimilarLoading) {
      return;
    }

    setIsRandomSimilarLoading(true);
    setRandomExploreError(null);

    try {
      const [randomPhoto] = await fetchRandomPhoto({ database });
      if (!randomPhoto) {
        setRandomExploreError(
          "No photos are available for random explore yet.",
        );
        return;
      }

      window.location.assign(
        `/slideshow?mode=similar&seed=${encodeURIComponent(randomPhoto.path)}`,
      );
    } catch (err) {
      console.error("Failed to load a random photo", err);
      setRandomExploreError("Couldn't start random explore right now.");
    } finally {
      setIsRandomSimilarLoading(false);
    }
  }, [database, isRandomSimilarLoading]);

  const startRandomSimilarSearch = useCallback(async () => {
    if (!database || isRandomSimilarLoading) {
      return;
    }

    setIsRandomSimilarLoading(true);
    setRandomExploreError(null);

    try {
      const [randomPhoto] = await fetchRandomPhoto({ database });
      if (!randomPhoto) {
        setRandomExploreError(
          "No photos are available for random explore yet.",
        );
        return;
      }

      clearSearchState();
      setSimilarPath(randomPhoto.path);
    } catch (err) {
      console.error("Failed to load a random photo", err);
      setRandomExploreError("Couldn't start random explore right now.");
    } finally {
      setIsRandomSimilarLoading(false);
    }
  }, [clearSearchState, database, isRandomSimilarLoading]);

  const handleFindSimilar = useCallback(
    (path: string, similarity?: number) => {
      if (path === similarPath) {
        return;
      }

      setSearchInputValue("");
      setSimilarTrail((prev) => {
        if (!similarPath) {
          return prev;
        }

        return [...prev, { path: similarPath, similarity }];
      });
      setSimilarPath(path);
    },
    [similarPath],
  );

  const handleToggleTag = useCallback((tagName: string, isActive: boolean) => {
    setSimilarPath(null);
    setSimilarTrail([]);
    setRandomExploreError(null);
    setSearchInputValue((prev) => {
      const nextTerms = parseSearchTerms(prev);
      const updatedTerms = isActive
        ? nextTerms.filter(
            (term) => term && term.trim().toLowerCase() !== tagName,
          )
        : [...nextTerms.filter((term) => term), tagName];
      return updatedTerms.join(",");
    });
  }, []);

  const handleSearchByColor = useCallback((color: RGB) => {
    setSearchInputValue("");
    setSimilarPath(null);
    setSimilarTrail([]);
    setRandomExploreError(null);
    setColorSearch(color);
  }, []);

  useEffect(() => {
    onNavStateChange?.({
      databaseReady: Boolean(database),
      isRandomSimilarLoading,
      onStartRandomSimilarSlideshow: loadRandomSimilarTrail,
      randomExploreError,
    });
  }, [
    database,
    isRandomSimilarLoading,
    loadRandomSimilarTrail,
    onNavStateChange,
    randomExploreError,
  ]);

  return (
    <div className={styles.searchWidget}>
      <SearchInputBar
        canClear={canClear}
        colorHex={colorHex}
        colorSearch={colorSearch}
        colorTolerance={colorTolerance}
        databaseReady={Boolean(database)}
        disabled={disabled}
        inputRef={inputRef}
        isColorMode={isColorMode}
        isFetching={isFetching}
        isSimilarMode={isSimilarMode}
        isSuccess={isSuccess}
        modeSourceRef={modeSourceRef}
        queryResultsLength={queryResults?.length}
        searchInputValue={searchInputValue}
        searchMode={searchMode}
        trimmedQuery={trimmedQuery}
        onApplySearchTerms={applySearchTerms}
        onClearSearchState={clearSearchState}
        onStartRandomSimilarSearch={startRandomSimilarSearch}
        onSetColorSearch={setColorSearch}
        onSetColorTolerance={setColorTolerance}
        onSetSearchMode={setSearchMode}
      />

      {!isSimilarMode && searchMode !== "keyword" && textModelProgress < 100 ? (
        <div className={styles.searchModeStatus}>
          <ProgressBar
            progress={textModelProgress}
            details={textModelProgressDetails}
          />
          <div>{textModelStage}</div>
        </div>
      ) : null}

      {needsEmbeddingsDatabase && !embeddingsDatabase ? (
        <div className={styles.searchModeStatus}>
          <ProgressBar
            progress={embeddingsProgress}
            details={embeddingsProgressDetails}
          />
          <div>Loading similarity index...</div>
        </div>
      ) : null}

      {!isSimilarMode && textVectorError ? (
        <div className={styles.inlineError}>{textVectorError}</div>
      ) : null}

      {needsEmbeddingsDatabase && embeddingsError ? (
        <div className={styles.inlineError}>
          Similarity search is unavailable right now.
        </div>
      ) : null}

      {isEmptyState ? (
        <EmptyStateExplore
          database={database}
          progress={progress}
          databaseProgressDetails={databaseProgressDetails}
          normalizedTags={normalizedTags}
          onApplySearchTerms={applySearchTerms}
          onStartSimilarSearch={startSimilarSearch}
        />
      ) : null}

      {!isEmptyState && !isColorMode && !isSimilarMode ? (
        <SearchRefinementSection
          databaseProgressDetails={databaseProgressDetails}
          normalizedSearchTerms={normalizedSearchTerms}
          normalizedTags={normalizedTags}
          progress={progress}
          refinementCounts={refinementCounts}
          onToggleTag={handleToggleTag}
        />
      ) : null}

      {isSimilarMode && similarPath ? (
        <SimilarTrailBar
          similarPath={similarPath}
          similarPreviewSrc={similarPreviewSrc}
          similarFilename={similarFilename}
          trail={similarTrail}
          sourceRef={modeSourceRef}
          onTruncate={truncateSimilarStack}
        />
      ) : null}

      <div>
        <SearchResultsGrid
          isSimilarMode={isSimilarMode}
          isColorMode={isColorMode}
          searchInputValue={searchInputValue}
          trimmedQuery={trimmedQuery}
          similarPath={similarPath}
          results={queryResults}
          isSuccess={isSuccess}
          isFetching={isFetching}
          isPlaceholderData={isPlaceholderData}
          hasNextPage={hasNextPage}
          similarClickstreamPaths={similarClickstreamPaths}
          onFindSimilar={handleFindSimilar}
          onSearchByColor={handleSearchByColor}
          onFetchNextPage={fetchNextPage}
        />
      </div>
    </div>
  );
};

export default Search;
