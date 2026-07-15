import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  fetchRandomPhoto,
  fetchRefinementTagCounts,
  fetchSearchFacetSections,
  fetchTags,
  hasStructuredGeocode,
} from "./api";
import { RGB } from "../../util/colorDistance";
import styles from "./Search.module.css";
import { useDatabase, useEmbeddingsDatabase } from "../database/useDatabase";
import { EmptyStateExplore } from "./EmptyStateExplore";
import { SearchInputBar } from "./SearchInputBar";
import { SearchFacetPanel, SearchFacetSection } from "./SearchFacetPanel";
import { SearchResultsGrid } from "./SearchResultsGrid";
import { SimilarTrailBar, SimilarTrailItem } from "./SimilarTrailBar";
import {
  DEFAULT_SEARCH_MODE,
  DEFAULT_SIMILARITY_ORDER,
  dedupeTags,
  getInitialSearchState,
  parseSearchTerms,
  SimilarityOrder,
  Tag,
} from "./searchUtils";
import { SearchMode } from "./useTextVector";
import { useImageQuery } from "./useImageQuery";
import { SearchDrawPad } from "./SearchDrawPad";
import { useSearchResultsState } from "./useSearchResultsState";
import {
  SearchFacetSelection,
  serializeSearchFacetSelection,
  writeSearchFacetSelections,
} from "../../util/searchFacets";
import { getActiveFilterCount, mergeFacetSections, normaliseSearchTerms } from "./searchViewModel";
import { useSearchFilterDrawer } from "./useSearchFilterDrawer";
import { SearchActiveFilters } from "./SearchActiveFilters";
import { navigateTo } from "../../util/navigate";

const useSafeLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Mirrors isEditableTarget in src/util/slideshowKeyboard.ts so the "/" focus
// shortcut never swallows characters typed into the search box or hex input.
export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof target !== "object") {
    return false;
  }

  const maybeElement = target as {
    tagName?: string;
    nodeName?: string;
    isContentEditable?: boolean;
  };
  const tagName = (maybeElement.tagName ?? maybeElement.nodeName ?? "").toUpperCase();

  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    maybeElement.isContentEditable === true
  );
};

export type SearchNavState = {
  databaseReady: boolean;
  /** Whichever resource is currently loading (database, similarity index, or
      an embedding model), surfaced once so the page can show a single progress
      bar by the heading instead of in-flow bars that shift content. `activity`
      names what is downloading — an unlabelled byte count reads as mystery
      data usage, especially for the large one-time model files. Null when
      idle. */
  loading: {
    progress: number;
    activity: string;
    details?: { loaded: number; total: number };
  } | null;
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
  const [similarityOrder, setSimilarityOrder] = useState<SimilarityOrder>(DEFAULT_SIMILARITY_ORDER);
  const [colorSearch, setColorSearch] = useState<RGB | null>(null);
  const [colorTolerance, setColorTolerance] = useState<number>(35);
  const [similarTrail, setSimilarTrail] = useState<SimilarTrailItem[]>([]);
  const [hasHydratedFromUrl, setHasHydratedFromUrl] = useState<boolean>(false);
  const [selectedFacets, setSelectedFacets] = useState<SearchFacetSelection[]>([]);
  const [facetCatalogSections, setFacetCatalogSections] = useState<SearchFacetSection[]>([]);
  const [facetSections, setFacetSections] = useState<SearchFacetSection[]>([]);
  const [isFacetSectionsLoading, setIsFacetSectionsLoading] = useState<boolean>(false);
  const [selectedFilterCategory, setSelectedFilterCategory] = useState<
    "tags" | "color" | "time" | "place" | "gear" | "settings"
  >("tags");
  const [isRandomSimilarLoading, setIsRandomSimilarLoading] = useState<boolean>(false);
  const [randomExploreError, setRandomExploreError] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [refinementCounts, setRefinementCounts] = useState<Record<string, number>>({});
  const [isDrawPadOpen, setIsDrawPadOpen] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const modeSourceRef = useRef<HTMLDivElement | null>(null);
  const [database, progress, databaseProgressDetails, databaseError, retryDatabase] = useDatabase();
  const {
    imageQuery,
    imageVectorError,
    imageModelProgress,
    imageModelProgressDetails,
    startImageQuery,
    clearImageQuery,
  } = useImageQuery();
  const needsEmbeddingsDatabase =
    Boolean(similarPath) ||
    Boolean(imageQuery) ||
    (!colorSearch && searchInputValue.trim() !== "" && searchMode !== "keyword");
  const [embeddingsDatabase, embeddingsProgress, embeddingsProgressDetails, embeddingsError] =
    useEmbeddingsDatabase(needsEmbeddingsDatabase);

  const {
    canClear,
    debouncedSearchQuery,
    fetchNextPage,
    hasNextPage,
    isColorMode,
    isError,
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
    textVectorError,
    trimmedQuery,
  } = useSearchResultsState({
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
    imageQuery,
  });
  const {
    isCompact: isFilterDrawerCompact,
    isOpen: isFilterDrawerOpen,
    open: openFilterDrawer,
    close: closeFilterDrawer,
    dialogRef: filterDialogRef,
    triggerRef: filterTriggerRef,
    closeRef: filterCloseRef,
  } = useSearchFilterDrawer({ isSimilarMode });

  const normalizedTags = useMemo(() => dedupeTags(tags), [tags]);
  const normalizedSearchTerms = useMemo(() => normaliseSearchTerms(searchQuery), [searchQuery]);
  const normalizedDebouncedSearchTerms = useMemo(
    () => normaliseSearchTerms(debouncedSearchQuery),
    [debouncedSearchQuery],
  );
  const normalizedTagNames = useMemo(() => normalizedTags.map((tag) => tag.name), [normalizedTags]);
  const liveFacetQueryTerms = useMemo(
    () => (searchMode === "keyword" ? normalizedDebouncedSearchTerms : []),
    [searchMode, normalizedDebouncedSearchTerms],
  );
  const visibleFacetSections = useMemo(
    () => mergeFacetSections(facetCatalogSections, facetSections, selectedFacets),
    [facetCatalogSections, facetSections, selectedFacets],
  );

  // Total filters currently applied — mirrors the "Active filters" chips
  // below, and badges the mobile drawer trigger.
  const activeFilterCount = getActiveFilterCount({
    selectedFacetCount: selectedFacets.length,
    searchTermCount: normalizedSearchTerms.length,
    hasColour: Boolean(colorSearch),
    hasImage: Boolean(imageQuery),
  });

  // A DB built by the fixed indexer has the geo_* columns and correct tag
  // counts; an older one stores them inflated by one. Probe is cached per DB.
  const tagCountsAreExact = database ? hasStructuredGeocode(database) : false;

  const similarClickstreamPaths = new Set([
    ...similarTrail.map((item) => item.path),
    ...(similarPath ? [similarPath] : []),
  ]);
  const isEmptyState =
    !isSimilarMode &&
    !isColorMode &&
    !imageQuery &&
    searchInputValue.trim() === "" &&
    selectedFacets.length === 0;

  // While the embeddings DB is still downloading, similar / pure-semantic /
  // image queries can't run yet — present the grid as pending (loading) instead
  // of a definitive empty state (HIGH-8). Hybrid is deliberately excluded: it
  // degrades to keyword-only ranking meanwhile rather than waiting.
  const isAwaitingVectorDatabase =
    needsEmbeddingsDatabase &&
    !embeddingsDatabase &&
    !embeddingsError &&
    (isSimilarMode || Boolean(imageQuery) || searchMode === "semantic");

  // The image query also waits on the vision model encoding the image itself.
  const isAwaitingImageVector = Boolean(imageQuery) && !imageQuery?.vector;

  useEffect(() => {
    const initialSearchState = getInitialSearchState();

    setSearchInputValue(initialSearchState.searchQuery.join(","));
    setSimilarPath(initialSearchState.similarPath);
    setSimilarityOrder(initialSearchState.similarityOrder);
    setColorSearch(initialSearchState.colorSearch);
    setSearchMode(initialSearchState.searchMode);
    setSelectedFacets(initialSearchState.selectedFacets);
    setHasHydratedFromUrl(initialSearchState.hasHydratedFromUrl);
  }, []);

  useEffect(() => {
    if (normalizedSearchTerms.length > 0) {
      setSelectedFilterCategory("tags");
    }
  }, [normalizedSearchTerms.length]);

  useEffect(() => {
    if (!hasHydratedFromUrl) {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    searchParams.delete("q");
    searchParams.delete("similar");
    searchParams.delete("similar_order");
    searchParams.delete("color");
    searchParams.delete("mode");
    writeSearchFacetSelections(searchParams, selectedFacets);

    if (similarPath) {
      searchParams.set("similar", similarPath);
      if (similarityOrder !== DEFAULT_SIMILARITY_ORDER) {
        searchParams.set("similar_order", similarityOrder);
      }
    }

    if (colorSearch) {
      searchParams.set("color", `${colorSearch[0]},${colorSearch[1]},${colorSearch[2]}`);
    }

    if (debouncedSearchQuery.length > 0) {
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
    selectedFacets,
    similarPath,
    similarityOrder,
  ]);

  useEffect(() => {
    function handler(ev: KeyboardEvent) {
      if (ev.key === "/" && !isEditableTarget(ev.target)) {
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
    if (!database) {
      setFacetCatalogSections([]);
      return;
    }

    let didCancel = false;

    fetchSearchFacetSections({ database })
      .then((sections) => {
        if (!didCancel) {
          setFacetCatalogSections(sections);
        }
      })
      .catch((err) => {
        if (!didCancel) {
          console.error("Failed to fetch search facet catalog", err);
          setFacetCatalogSections([]);
        }
      });

    return () => {
      didCancel = true;
    };
  }, [database]);

  useEffect(() => {
    if (!database) {
      setFacetSections([]);
      setIsFacetSectionsLoading(false);
      return;
    }

    if (isSimilarMode) {
      setFacetSections([]);
      setIsFacetSectionsLoading(false);
      return;
    }

    let didCancel = false;
    setIsFacetSectionsLoading(true);

    fetchSearchFacetSections({
      database,
      activeTerms: liveFacetQueryTerms,
      selectedFacets,
    })
      .then((sections) => {
        if (!didCancel) {
          setFacetSections(sections);
        }
      })
      .catch((err) => {
        if (!didCancel) {
          console.error("Failed to fetch search facets", err);
          setFacetSections([]);
        }
      })
      .finally(() => {
        if (!didCancel) {
          setIsFacetSectionsLoading(false);
        }
      });

    return () => {
      didCancel = true;
    };
  }, [database, isColorMode, isSimilarMode, liveFacetQueryTerms, searchMode, selectedFacets]);

  useEffect(() => {
    if (
      !database ||
      searchMode !== "keyword" ||
      isSimilarMode ||
      isColorMode ||
      (normalizedDebouncedSearchTerms.length === 0 && selectedFacets.length === 0)
    ) {
      setRefinementCounts({});
      return;
    }

    let didCancel = false;

    fetchRefinementTagCounts({
      database,
      activeTerms: normalizedDebouncedSearchTerms,
      candidateTags: normalizedTagNames,
      selectedFacets,
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
    searchMode,
    normalizedDebouncedSearchTerms,
    normalizedTagNames,
    selectedFacets,
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

  const applySearchTerms = useCallback(
    (terms: string[]) => {
      setSimilarPath(null);
      setSimilarTrail([]);
      setRandomExploreError(null);
      clearImageQuery();
      // Keep any active colour filter — colour composes with the text query, so
      // typing must not silently clear it (the facet panel adds colour the same
      // composable way).
      setSearchInputValue(terms.join(","));
    },
    [clearImageQuery],
  );

  const clearSearchState = useCallback(() => {
    setSearchInputValue("");
    setSimilarPath(null);
    setSimilarTrail([]);
    setColorSearch(null);
    setSelectedFacets([]);
    clearImageQuery();
  }, [clearImageQuery]);

  // Starting an image query replaces text/similar mode, but keeps colour and
  // facets — they compose with the vector ranking the same way they do for a
  // semantic text query.
  const handleImageQuery = useCallback(
    (blob: Blob, source: "upload" | "drawing") => {
      setSearchInputValue("");
      setSimilarPath(null);
      setSimilarTrail([]);
      setRandomExploreError(null);
      setIsDrawPadOpen(false);
      startImageQuery(blob, source);
    },
    [startImageQuery],
  );

  const truncateSimilarStack = useCallback((breadcrumbIndex: number) => {
    setSimilarTrail((prev) => {
      const nextCurrentPath = breadcrumbIndex > 0 ? prev[breadcrumbIndex - 1]!.path : null;
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
        setRandomExploreError("No photos are available for random explore yet.");
        return;
      }

      navigateTo(`/slideshow?mode=similar&seed=${encodeURIComponent(randomPhoto.path)}`);
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
        setRandomExploreError("No photos are available for random explore yet.");
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
      setSelectedFacets([]);
      clearImageQuery();
      setSimilarTrail((prev) => {
        if (!similarPath) {
          return prev;
        }

        return [...prev, { path: similarPath, similarity }];
      });
      setSimilarPath(path);
    },
    [clearImageQuery, similarPath],
  );

  const handleToggleTag = useCallback(
    (tagName: string, isActive: boolean) => {
      setSimilarPath(null);
      setSimilarTrail([]);
      setRandomExploreError(null);
      clearImageQuery();
      setSearchInputValue((prev) => {
        const nextTerms = parseSearchTerms(prev);
        const updatedTerms = isActive
          ? nextTerms.filter((term) => term && term.trim().toLowerCase() !== tagName)
          : [...nextTerms.filter((term) => term), tagName];
        return updatedTerms.join(",");
      });
    },
    [clearImageQuery],
  );

  // Per-tile "use this photo's colour" action: starts a fresh colour search,
  // clearing any text query and similarity trail.
  const handleSearchByColor = useCallback(
    (color: RGB) => {
      setSearchInputValue("");
      setSimilarPath(null);
      setSimilarTrail([]);
      setRandomExploreError(null);
      clearImageQuery();
      setColorSearch(color);
      setSelectedFilterCategory("color");
    },
    [clearImageQuery],
  );

  // Facet-panel colour picker: composes with the current text query/facets, so
  // it must not clear the search input the way the per-tile action does.
  const handleFacetColorSearch = useCallback((color: RGB) => {
    setSimilarPath(null);
    setSimilarTrail([]);
    setRandomExploreError(null);
    setColorSearch(color);
  }, []);

  const handleClearColorSearch = useCallback(() => {
    setColorSearch(null);
  }, []);

  const handleRemoveFacet = useCallback((selection: SearchFacetSelection) => {
    const key = serializeSearchFacetSelection(selection);
    setSelectedFacets((prev) =>
      prev.filter((facet) => serializeSearchFacetSelection(facet) !== key),
    );
  }, []);

  const handleToggleFacet = useCallback((selection: SearchFacetSelection) => {
    const key = serializeSearchFacetSelection(selection);
    setSimilarPath(null);
    setSimilarTrail([]);
    setRandomExploreError(null);
    setSelectedFacets((prev) => {
      const alreadySelected = prev.some((facet) => serializeSearchFacetSelection(facet) === key);
      if (alreadySelected) {
        return prev.filter((facet) => serializeSearchFacetSelection(facet) !== key);
      }
      return [...prev, selection];
    });
  }, []);

  const handleRemoveSearchTerm = useCallback((termToRemove: string) => {
    setSearchInputValue((prev) =>
      parseSearchTerms(prev)
        .filter((term) => term.trim().toLowerCase() !== termToRemove)
        .join(","),
    );
  }, []);

  useEffect(() => {
    const loading = databaseError
      ? null
      : progress < 100
        ? {
            progress,
            details: databaseProgressDetails,
            activity: "Downloading search index",
          }
        : needsEmbeddingsDatabase && !embeddingsDatabase && !embeddingsError
          ? {
              progress: embeddingsProgress,
              details: embeddingsProgressDetails,
              activity: "Downloading similarity index",
            }
          : imageQuery && imageModelProgress < 100
            ? {
                progress: imageModelProgress,
                details: imageModelProgressDetails,
                activity: "Downloading image search model (one-time)",
              }
            : !isSimilarMode && searchMode !== "keyword" && textModelProgress < 100
              ? {
                  progress: textModelProgress,
                  details: textModelProgressDetails,
                  activity: "Downloading semantic search model (one-time)",
                }
              : null;

    onNavStateChange?.({
      databaseReady: Boolean(database),
      loading,
      isRandomSimilarLoading,
      onStartRandomSimilarSlideshow: loadRandomSimilarTrail,
      randomExploreError,
    });
  }, [
    database,
    databaseError,
    progress,
    databaseProgressDetails,
    needsEmbeddingsDatabase,
    embeddingsDatabase,
    embeddingsError,
    embeddingsProgress,
    embeddingsProgressDetails,
    imageQuery,
    imageModelProgress,
    imageModelProgressDetails,
    isSimilarMode,
    searchMode,
    textModelProgress,
    textModelProgressDetails,
    isRandomSimilarLoading,
    loadRandomSimilarTrail,
    onNavStateChange,
    randomExploreError,
  ]);

  return (
    <div className={styles.searchWidget}>
      <SearchInputBar
        canClear={canClear}
        databaseReady={Boolean(database)}
        disabled={disabled}
        inputRef={inputRef}
        isFetching={isFetching}
        isSimilarMode={isSimilarMode}
        isSuccess={isSuccess}
        queryResultsLength={queryResults?.length}
        searchInputValue={searchInputValue}
        searchMode={searchMode}
        trimmedQuery={trimmedQuery}
        onApplySearchTerms={applySearchTerms}
        onClearSearchState={clearSearchState}
        onStartRandomSimilarSearch={startRandomSimilarSearch}
        onSetSearchMode={setSearchMode}
        onPickImageQuery={(file) => handleImageQuery(file, "upload")}
        onOpenDrawPad={() => setIsDrawPadOpen(true)}
      />

      {isDrawPadOpen ? (
        <SearchDrawPad
          onCancel={() => setIsDrawPadOpen(false)}
          onSubmit={(blob) => handleImageQuery(blob, "drawing")}
        />
      ) : null}

      {!isSimilarMode ? (
        isFilterDrawerCompact ? (
          <>
            <button
              type="button"
              ref={filterTriggerRef}
              className={styles.filterTrigger}
              aria-expanded={isFilterDrawerOpen}
              aria-controls="search-filter-drawer"
              onClick={openFilterDrawer}
            >
              <span aria-hidden="true">⚙</span>
              <span>Filters</span>
              {activeFilterCount > 0 ? (
                <span className={styles.filterTriggerBadge}>{activeFilterCount}</span>
              ) : null}
            </button>

            {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
            <dialog
              ref={filterDialogRef}
              id="search-filter-drawer"
              className={styles.filterDrawer}
              aria-label="Search filters"
              onCancel={(event) => {
                event.preventDefault();
                closeFilterDrawer();
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  closeFilterDrawer();
                }
              }}
            >
              <div className={styles.filterDrawerHandle} aria-hidden="true">
                <span className={styles.filterDrawerGrip} />
              </div>
              <div className={styles.filterDrawerHeader}>
                <span className={styles.filterDrawerTitle}>Filters</span>
                <button
                  type="button"
                  ref={filterCloseRef}
                  className={styles.filterDrawerClose}
                  onClick={closeFilterDrawer}
                >
                  Done
                </button>
              </div>

              <SearchFacetPanel
                sections={visibleFacetSections}
                selectedCategory={selectedFilterCategory}
                colorSearch={colorSearch}
                colorTolerance={colorTolerance}
                selectedFacets={selectedFacets}
                normalizedSearchTerms={normalizedSearchTerms}
                normalizedTags={normalizedTags}
                refinementCounts={refinementCounts}
                tagCountsAreExact={tagCountsAreExact}
                isLoading={isFacetSectionsLoading}
                onSelectCategory={setSelectedFilterCategory}
                onClearColorSearch={handleClearColorSearch}
                onSetColorSearch={handleFacetColorSearch}
                onSetColorTolerance={setColorTolerance}
                onToggleFacet={handleToggleFacet}
                onToggleTag={handleToggleTag}
              />
            </dialog>
          </>
        ) : (
          <div className={styles.filterInline}>
            <SearchFacetPanel
              sections={visibleFacetSections}
              selectedCategory={selectedFilterCategory}
              colorSearch={colorSearch}
              colorTolerance={colorTolerance}
              selectedFacets={selectedFacets}
              normalizedSearchTerms={normalizedSearchTerms}
              normalizedTags={normalizedTags}
              refinementCounts={refinementCounts}
              tagCountsAreExact={tagCountsAreExact}
              isLoading={isFacetSectionsLoading}
              onSelectCategory={setSelectedFilterCategory}
              onClearColorSearch={handleClearColorSearch}
              onSetColorSearch={handleFacetColorSearch}
              onSetColorTolerance={setColorTolerance}
              onToggleFacet={handleToggleFacet}
              onToggleTag={handleToggleTag}
            />
          </div>
        )
      ) : null}

      {/* DB / similarity-index / text-model download progress is shown once,
          beside the page heading (see pages/search), so it never adds an
          in-flow bar that shifts the results below. */}

      {databaseError ? (
        <div className={styles.inlineError}>
          Couldn&apos;t load the search index.{" "}
          <button type="button" className={styles.retryButton} onClick={() => retryDatabase()}>
            Try again
          </button>
        </div>
      ) : null}

      {!isSimilarMode && textVectorError ? (
        <div className={styles.inlineError}>{textVectorError}</div>
      ) : null}

      {imageVectorError ? <div className={styles.inlineError}>{imageVectorError}</div> : null}

      {needsEmbeddingsDatabase && embeddingsError ? (
        <div className={styles.inlineError}>Similarity search is unavailable right now.</div>
      ) : null}

      {isEmptyState ? (
        <EmptyStateExplore
          database={database}
          onStartSimilarSearch={startSimilarSearch}
          onSearchByColor={selectedFilterCategory === "color" ? handleSearchByColor : undefined}
          isColorCategoryActive={selectedFilterCategory === "color"}
        />
      ) : null}

      {isSimilarMode && similarPath ? (
        <SimilarTrailBar
          similarPath={similarPath}
          similarPreviewSrc={similarPreviewSrc}
          similarFilename={similarFilename}
          similarityOrder={similarityOrder}
          trail={similarTrail}
          sourceRef={modeSourceRef}
          onSetSimilarityOrder={setSimilarityOrder}
          onTruncate={truncateSimilarStack}
        />
      ) : null}

      <SearchActiveFilters
        imageQuery={imageQuery}
        colour={colorSearch}
        searchTerms={normalizedSearchTerms}
        selectedFacets={selectedFacets}
        onClearImage={clearImageQuery}
        onClearColour={handleClearColorSearch}
        onRemoveTerm={handleRemoveSearchTerm}
        onRemoveFacet={handleRemoveFacet}
      />

      <div>
        <SearchResultsGrid
          isSimilarMode={isSimilarMode}
          isColorMode={isColorMode}
          isImageQueryMode={Boolean(imageQuery)}
          isColorCategoryActive={selectedFilterCategory === "color"}
          hasFacetFilters={selectedFacets.length > 0}
          searchInputValue={searchInputValue}
          trimmedQuery={trimmedQuery}
          similarPath={similarPath}
          results={queryResults}
          isSuccess={isSuccess}
          isError={isError}
          isFetching={isFetching}
          isAwaitingResults={isAwaitingVectorDatabase || isAwaitingImageVector}
          isPlaceholderData={isPlaceholderData}
          hasNextPage={hasNextPage}
          similarClickstreamPaths={similarClickstreamPaths}
          onFindSimilar={handleFindSimilar}
          onSearchByColor={
            selectedFilterCategory === "color" || colorSearch ? handleSearchByColor : undefined
          }
          onFetchNextPage={fetchNextPage}
        />
      </div>
    </div>
  );
};

export default Search;
