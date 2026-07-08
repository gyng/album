import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchRandomPhoto,
  fetchRefinementTagCounts,
  fetchSearchFacetSections,
  fetchTags,
  hasStructuredGeocode,
} from "./api";
import { RGB } from "../../util/colorDistance";
import styles from "./Search.module.css";
import {
  useDatabase,
  useEmbeddingsDatabase,
} from "../database/useDatabase";
import { EmptyStateExplore } from "./EmptyStateExplore";
import { SearchInputBar } from "./SearchInputBar";
import {
  SearchFacetPanel,
  SearchFacetSection,
} from "./SearchFacetPanel";
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
  getSearchFacetChipLabel,
  SearchFacetSelection,
  serializeSearchFacetSelection,
  writeSearchFacetSelections,
} from "../../util/searchFacets";
import { rgbToHex, rgbToString } from "../../util/colorDistance";

const useSafeLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// Mirrors isEditableTarget in src/util/slideshowKeyboard.ts so the "/" focus
// shortcut never swallows characters typed into the search box or hex input.
const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof target !== "object") {
    return false;
  }

  const maybeElement = target as {
    tagName?: string;
    nodeName?: string;
    isContentEditable?: boolean;
  };
  const tagName = (
    maybeElement.tagName ??
    maybeElement.nodeName ??
    ""
  ).toUpperCase();

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
      text model), surfaced once so the page can show a single progress bar by
      the heading instead of in-flow bars that shift content. Null when idle. */
  loading: {
    progress: number;
    details?: { loaded: number; total: number };
  } | null;
  isRandomSimilarLoading: boolean;
  onStartRandomSimilarSlideshow: () => void;
  randomExploreError: string | null;
};

const mergeFacetSections = (
  catalogSections: SearchFacetSection[],
  liveSections: SearchFacetSection[],
  selectedFacets: SearchFacetSelection[],
): SearchFacetSection[] => {
  const liveSectionMap = new Map(
    liveSections.map((section) => [section.facetId, section]),
  );
  const selectedValuesByFacet = new Map<string, Set<string>>();
  selectedFacets.forEach((selection) => {
    const values = selectedValuesByFacet.get(selection.facetId) ?? new Set<string>();
    values.add(selection.value);
    selectedValuesByFacet.set(selection.facetId, values);
  });

  const mergeSection = (section: SearchFacetSection): SearchFacetSection => {
    const liveSection = liveSectionMap.get(section.facetId);
    const liveOptionMap = new Map(
      (liveSection?.options ?? []).map((option) => [option.value, option.count]),
    );
    const orderedOptions = [...section.options];

    (liveSection?.options ?? []).forEach((option) => {
      if (!orderedOptions.some((candidate) => candidate.value === option.value)) {
        orderedOptions.push(option);
      }
    });

    Array.from(selectedValuesByFacet.get(section.facetId) ?? []).forEach((value) => {
      if (!orderedOptions.some((candidate) => candidate.value === value)) {
        orderedOptions.push({ value, count: 0 });
      }
    });

    return {
      ...section,
      options: orderedOptions.map((option) => ({
        value: option.value,
        count: liveOptionMap.get(option.value) ?? 0,
      })),
    };
  };

  const merged = catalogSections.map(mergeSection);

  liveSections.forEach((section) => {
    if (!catalogSections.some((candidate) => candidate.facetId === section.facetId)) {
      merged.push(
        mergeSection({
          facetId: section.facetId,
          displayName: section.displayName,
          options: section.options,
        }),
      );
    }
  });

  return merged;
};

export const Search: React.FC<{
  disabled?: boolean;
  onNavStateChange?: (state: SearchNavState) => void;
}> = ({ disabled, onNavStateChange }) => {
  const [searchInputValue, setSearchInputValue] = useState<string>("");
  const [searchMode, setSearchMode] = useState<SearchMode>(DEFAULT_SEARCH_MODE);
  const [similarPath, setSimilarPath] = useState<string | null>(null);
  const [similarityOrder, setSimilarityOrder] =
    useState<SimilarityOrder>(DEFAULT_SIMILARITY_ORDER);
  const [colorSearch, setColorSearch] = useState<RGB | null>(null);
  const [colorTolerance, setColorTolerance] = useState<number>(35);
  const [similarTrail, setSimilarTrail] = useState<SimilarTrailItem[]>([]);
  const [hasHydratedFromUrl, setHasHydratedFromUrl] = useState<boolean>(false);
  const [selectedFacets, setSelectedFacets] = useState<SearchFacetSelection[]>(
    [],
  );
  const [facetCatalogSections, setFacetCatalogSections] = useState<
    SearchFacetSection[]
  >([]);
  const [facetSections, setFacetSections] = useState<SearchFacetSection[]>([]);
  const [isFacetSectionsLoading, setIsFacetSectionsLoading] =
    useState<boolean>(false);
  const [selectedFilterCategory, setSelectedFilterCategory] = useState<
    "tags" | "color" | "time" | "place" | "gear" | "settings"
  >("tags");
  const [isRandomSimilarLoading, setIsRandomSimilarLoading] =
    useState<boolean>(false);
  const [randomExploreError, setRandomExploreError] = useState<string | null>(
    null,
  );
  const [tags, setTags] = useState<Tag[]>([]);
  const [refinementCounts, setRefinementCounts] = useState<
    Record<string, number>
  >({});
  // On phones the facet panel is collapsed behind this trigger so results
  // lead; on desktop the trigger is hidden and the panel lays out inline.
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState<boolean>(false);
  const [isDrawPadOpen, setIsDrawPadOpen] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const filterCloseRef = useRef<HTMLButtonElement | null>(null);
  const modeSourceRef = useRef<HTMLDivElement | null>(null);
  const [
    database,
    progress,
    databaseProgressDetails,
    databaseError,
    retryDatabase,
  ] = useDatabase();
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
  const liveFacetQueryTerms = useMemo(
    () =>
      searchMode === "keyword" ? normalizedDebouncedSearchTerms : [],
    [searchMode, normalizedDebouncedSearchTerms],
  );
  const visibleFacetSections = useMemo(
    () => mergeFacetSections(facetCatalogSections, facetSections, selectedFacets),
    [facetCatalogSections, facetSections, selectedFacets],
  );

  // Total filters currently applied — mirrors the "Active filters" chips
  // below, and badges the mobile drawer trigger.
  const activeFilterCount =
    selectedFacets.length +
    normalizedSearchTerms.length +
    (colorSearch ? 1 : 0) +
    (imageQuery ? 1 : 0);

  // A DB built by the fixed indexer has the geo_* columns and correct tag
  // counts; an older one stores them inflated by one. Probe is cached per DB.
  const tagCountsAreExact = database ? hasStructuredGeocode(database) : false;

  // While the mobile filter drawer is open: Escape closes it, background
  // scroll is locked, and focus moves into it (and back to the trigger on
  // close) for keyboard and screen-reader users. Inert on desktop — the
  // trigger is hidden there, so the drawer can't open.
  useEffect(() => {
    if (!isFilterDrawerOpen) {
      return;
    }
    filterCloseRef.current?.focus();
    // The trigger is a stable element for the drawer's lifetime; capture it now
    // so the cleanup restores focus to it without reading a possibly-changed ref.
    const trigger = filterTriggerRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFilterDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [isFilterDrawerOpen]);

  // Similar mode hides the facet panel entirely — make sure the drawer can't
  // linger open across that transition.
  useEffect(() => {
    if (isSimilarMode) {
      setIsFilterDrawerOpen(false);
    }
  }, [isSimilarMode]);

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
      searchParams.set(
        "color",
        `${colorSearch[0]},${colorSearch[1]},${colorSearch[2]}`,
      );
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
  }, [
    database,
    isColorMode,
    isSimilarMode,
    liveFacetQueryTerms,
    searchMode,
    selectedFacets,
  ]);

  useEffect(() => {
    if (
      !database ||
      searchMode !== "keyword" ||
      isSimilarMode ||
      isColorMode ||
      (normalizedDebouncedSearchTerms.length === 0 &&
        selectedFacets.length === 0)
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
          ? nextTerms.filter(
              (term) => term && term.trim().toLowerCase() !== tagName,
            )
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
      const alreadySelected = prev.some(
        (facet) => serializeSearchFacetSelection(facet) === key,
      );
      if (alreadySelected) {
        return prev.filter(
          (facet) => serializeSearchFacetSelection(facet) !== key,
        );
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
        ? { progress, details: databaseProgressDetails }
        : needsEmbeddingsDatabase && !embeddingsDatabase && !embeddingsError
          ? { progress: embeddingsProgress, details: embeddingsProgressDetails }
          : imageQuery && imageModelProgress < 100
            ? {
                progress: imageModelProgress,
                details: imageModelProgressDetails,
              }
            : !isSimilarMode &&
                searchMode !== "keyword" &&
                textModelProgress < 100
              ? {
                  progress: textModelProgress,
                  details: textModelProgressDetails,
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
        <>
          {/* Mobile-only: collapses the panel behind a trigger so results
              lead. Hidden on desktop (the panel renders inline below). */}
          <button
            type="button"
            ref={filterTriggerRef}
            className={styles.filterTrigger}
            aria-expanded={isFilterDrawerOpen}
            aria-controls="search-filter-drawer"
            onClick={() => setIsFilterDrawerOpen(true)}
          >
            <span aria-hidden="true">⚙</span>
            <span>Filters</span>
            {activeFilterCount > 0 ? (
              <span className={styles.filterTriggerBadge}>
                {activeFilterCount}
              </span>
            ) : null}
          </button>

          {/* Backdrop only exists (and only catches taps) while open on
              mobile; on desktop the drawer wrapper is display: contents so
              the panel lays out exactly as before. */}
          <div
            className={[
              styles.filterBackdrop,
              isFilterDrawerOpen ? styles.filterBackdropOpen : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setIsFilterDrawerOpen(false)}
            aria-hidden="true"
          />

          <div
            id="search-filter-drawer"
            className={[
              styles.filterDrawer,
              isFilterDrawerOpen ? styles.filterDrawerOpen : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="dialog"
            aria-modal={isFilterDrawerOpen}
            aria-label="Search filters"
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
                onClick={() => setIsFilterDrawerOpen(false)}
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
          </div>
        </>
      ) : null}

      {/* DB / similarity-index / text-model download progress is shown once,
          beside the page heading (see pages/search), so it never adds an
          in-flow bar that shifts the results below. */}

      {databaseError ? (
        <div className={styles.inlineError}>
          Couldn&apos;t load the search index.{" "}
          <button
            type="button"
            className={styles.retryButton}
            onClick={() => retryDatabase()}
          >
            Try again
          </button>
        </div>
      ) : null}

      {!isSimilarMode && textVectorError ? (
        <div className={styles.inlineError}>{textVectorError}</div>
      ) : null}

      {imageVectorError ? (
        <div className={styles.inlineError}>{imageVectorError}</div>
      ) : null}

      {needsEmbeddingsDatabase && embeddingsError ? (
        <div className={styles.inlineError}>
          Similarity search is unavailable right now.
        </div>
      ) : null}

      {isEmptyState ? (
        <EmptyStateExplore
          database={database}
          onStartSimilarSearch={startSimilarSearch}
          onSearchByColor={
            selectedFilterCategory === "color"
              ? handleSearchByColor
              : undefined
          }
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

      {selectedFacets.length > 0 ||
      normalizedSearchTerms.length > 0 ||
      colorSearch ||
      imageQuery ? (
        <div className={styles.activeFacetSection}>
          <div className={styles.activeFacetLabel}>Active filters</div>
          <div className={styles.activeFacetChips}>
            {imageQuery ? (
              <button
                key="image-query"
                type="button"
                className={styles.activeFacetChip}
                onClick={clearImageQuery}
                title="Remove image query"
                aria-label="Remove image query"
              >
                {/* Plain img: the preview is an in-memory object URL, which
                    next/image can't optimise. */}
                <img
                  className={styles.activeFacetImageThumb}
                  src={imageQuery.previewUrl}
                  alt=""
                  aria-hidden="true"
                />
                <span>
                  {imageQuery.source === "drawing"
                    ? "Drawn sketch"
                    : "Uploaded image"}
                </span>
                <span aria-hidden="true">×</span>
                {/* Zoomed copy of the query image, revealed on hover/focus —
                    the 20px chip thumbnail is too small to recognise. */}
                <span
                  className={styles.activeFacetImageZoom}
                  data-testid="image-query-zoom"
                  aria-hidden="true"
                >
                  <img src={imageQuery.previewUrl} alt="" />
                </span>
              </button>
            ) : null}
            {colorSearch ? (
              <button
                key="color-filter"
                type="button"
                className={styles.activeFacetChip}
                onClick={handleClearColorSearch}
                title={`Remove filter Colour: ${rgbToHex(colorSearch)}`}
                aria-label={`Remove filter Colour: ${rgbToHex(colorSearch)}`}
              >
                <span
                  className={styles.activeFacetColorSwatch}
                  style={{ backgroundColor: rgbToString(colorSearch) }}
                  aria-hidden="true"
                />
                <span>{`Colour: ${rgbToHex(colorSearch)}`}</span>
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {normalizedSearchTerms.map((term) => (
              <button
                key={`term-${term}`}
                type="button"
                className={styles.activeFacetChip}
                onClick={() => {
                  handleRemoveSearchTerm(term);
                }}
                title={`Remove filter ${term}`}
                aria-label={`Remove filter ${term}`}
              >
                <span>{term}</span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
            {selectedFacets.map((selection) => {
              const key = serializeSearchFacetSelection(selection);
              const chipLabel = getSearchFacetChipLabel(selection);
              return (
                <button
                  key={key}
                  type="button"
                  className={styles.activeFacetChip}
                  onClick={() => {
                    handleRemoveFacet(selection);
                  }}
                  title={`Remove filter ${chipLabel}`}
                  aria-label={`Remove filter ${chipLabel}`}
                >
                  <span>{chipLabel}</span>
                  <span aria-hidden="true">×</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

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
            selectedFilterCategory === "color" || colorSearch
              ? handleSearchByColor
              : undefined
          }
          onFetchNextPage={fetchNextPage}
        />
      </div>
    </div>
  );
};

export default Search;
