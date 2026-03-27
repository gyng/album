import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import styles from "./Search.module.css";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchRefinementTagCounts,
  fetchHybridResults,
  fetchRecentResults,
  fetchRandomResults,
  fetchResults,
  fetchRandomPhoto,
  fetchSemanticResults,
  fetchSimilarResults,
  fetchTags,
  PaginatedSearchResult,
} from "./api";
import { SearchResultTile } from "./SearchResultTile";
import { SearchTag } from "./SearchTag";
import { useDatabase } from "../database/useDatabase";
import { ProgressBar } from "../ProgressBar";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";
import { SearchResultRow } from "./searchTypes";
import { encodeSearchText, warmupTextEmbeddingModel } from "./textEmbeddings";

type Tag = {
  name: string;
  count: number;
};

type SearchMode = "keyword" | "semantic" | "hybrid";

type InitialSearchState = {
  searchQuery: string[];
  similarPath: string | null;
  searchMode: SearchMode;
  hasHydratedFromUrl: boolean;
};

type SimilarTrailItem = {
  path: string;
  similarity?: number;
};

const similarSearchEmojiStyle = { filter: "grayscale(100%)" } as const;

const useSafeLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const SharedTagsCaption = () => (
  <>
    keep stacking keywords to narrow results, or click{" "}
    <span style={similarSearchEmojiStyle}>🔍</span> to find similar photos
  </>
);

const forceDocumentNavigation = (
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string,
) => {
  event.preventDefault();
  window.location.assign(href);
};

const dedupeTags = (tags: Tag[]): Tag[] => {
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

const parseSearchTerms = (value: string): string[] => {
  if (value === "") {
    return [];
  }

  return value.split(",");
};

const isSearchMode = (value: string | null): value is SearchMode => {
  return value === "keyword" || value === "semantic" || value === "hybrid";
};

const DEFAULT_SEARCH_MODE: SearchMode = "hybrid";

const getInitialSearchState = (): InitialSearchState => {
  if (typeof window === "undefined") {
    return {
      searchQuery: [],
      similarPath: null,
      searchMode: DEFAULT_SEARCH_MODE,
      hasHydratedFromUrl: false,
    };
  }

  const url = new URL(window.location.toString());
  const query = url.searchParams.get("q");

  return {
    searchQuery: query ? query.split(",").map((value) => value.trim()) : [],
    similarPath: url.searchParams.get("similar"),
    searchMode: isSearchMode(url.searchParams.get("mode"))
      ? (url.searchParams.get("mode") as SearchMode)
      : DEFAULT_SEARCH_MODE,
    hasHydratedFromUrl: true,
  };
};

const getAlbumAnchorHref = (path: string): string => {
  const segments = path.split("/");
  const albumName = segments.at(-2);
  const filename = segments.at(-1);

  if (!albumName || !filename) {
    return "/search";
  }

  return `/album/${albumName}#${filename}`;
};

export const Search: React.FC<{ disabled?: boolean }> = (props) => {
  const PAGE_SIZE = 48;
  const RECENT_ROW_INITIAL_SIZE = 15;
  const RECENT_ROW_LOAD_MORE_SIZE = 16;
  const RANDOM_ROW_INITIAL_SIZE = 7;
  const RANDOM_ROW_LOAD_MORE_SIZE = 8;
  const [searchInputValue, setSearchInputValue] = useState<string>("");
  const [searchMode, setSearchMode] = useState<SearchMode>(DEFAULT_SEARCH_MODE);
  const [similarPath, setSimilarPath] = useState<string | null>(null);
  const [similarTrail, setSimilarTrail] = useState<SimilarTrailItem[]>([]);
  const [hasHydratedFromUrl, setHasHydratedFromUrl] = useState<boolean>(false);
  const [textVector, setTextVector] = useState<number[] | null>(null);
  const [textVectorQuery, setTextVectorQuery] = useState<string | null>(null);
  const [isTextVectorLoading, setIsTextVectorLoading] = useState<boolean>(false);
  const [textModelProgress, setTextModelProgress] = useState<number>(100);
  const [textModelStage, setTextModelStage] = useState<string>("Loading semantic search model...");
  const [textModelProgressDetails, setTextModelProgressDetails] = useState<{
    loaded: number;
    total: number;
    file?: string;
  }>({ loaded: 0, total: 0 });
  const [textVectorError, setTextVectorError] = useState<string | null>(null);
  const [debouncedSearchInputValue] = useDebounce(searchInputValue, 600);
  const inputRef = useRef<HTMLInputElement>(null);
  const modeSourceRef = useRef<HTMLDivElement | null>(null);
  const randomLoadMoreButtonRef = useRef<HTMLButtonElement | null>(null);
  const breadcrumbRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const breadcrumbPositionsRef = useRef<Record<string, DOMRect>>({});
  const [database, progress, databaseProgressDetails] = useDatabase();
  const searchQuery = useMemo(
    () => parseSearchTerms(searchInputValue),
    [searchInputValue],
  );
  const debouncedSearchQuery = useMemo(
    () => parseSearchTerms(debouncedSearchInputValue),
    [debouncedSearchInputValue],
  );
  const isSimilarMode = Boolean(similarPath);
  const trimmedQuery = debouncedSearchQuery.join(" ").trim();
  const hasSearchQuery = trimmedQuery.length > 0;
  const keywordQuery = debouncedSearchQuery.join("|");
  const needsTextVector = !isSimilarMode && hasSearchQuery && searchMode !== "keyword";
  const hasCurrentTextVector = Boolean(textVector) && textVectorQuery === trimmedQuery;
  const canRunQuery =
    hasHydratedFromUrl &&
    Boolean(database) &&
    (Boolean(similarPath) ||
      (hasSearchQuery && (searchMode === "keyword" || hasCurrentTextVector)));
  const similarFilename = similarPath?.split("/").at(-1) ?? null;
  const similarPreviewSrc = similarPath
    ? getResizedAlbumImageSrc(similarPath)
    : null;

  useEffect(() => {
    const initialSearchState = getInitialSearchState();
    setSearchInputValue(initialSearchState.searchQuery.join(","));
    setSimilarPath(initialSearchState.similarPath);
    setSearchMode(initialSearchState.searchMode);
    setHasHydratedFromUrl(initialSearchState.hasHydratedFromUrl);
  }, []);

  useEffect(() => {
    if (isSimilarMode || searchMode === "keyword") {
      return;
    }

    setTextModelProgress(0);
    setTextModelStage("Loading semantic search model...");
    setTextModelProgressDetails({ loaded: 0, total: 0 });

    void warmupTextEmbeddingModel((progress, stage, details) => {
      setTextModelProgress(progress);
      setTextModelStage(stage);
      setTextModelProgressDetails(details ?? { loaded: 0, total: 0 });
    })
    .then(() => {
      setTextModelProgress(100);
      setTextModelStage("Search model ready");
      setTextModelProgressDetails({ loaded: 0, total: 0 });
    })
    .catch((err) => {
      console.warn("Failed to warm semantic search model", err);
      setTextModelProgress(100);
      setTextModelProgressDetails({ loaded: 0, total: 0 });
    });
  }, [isSimilarMode, searchMode]);

  useEffect(() => {
    if (!needsTextVector) {
      setTextVector(null);
      setTextVectorQuery(null);
      setIsTextVectorLoading(false);
      setTextVectorError(null);
      setTextModelProgressDetails({ loaded: 0, total: 0 });
      return;
    }

    let didCancel = false;
    const queryText = trimmedQuery;
    setTextVector(null);
    setTextVectorQuery(null);
    setIsTextVectorLoading(true);
    setTextVectorError(null);

    encodeSearchText(queryText, (progress, stage, details) => {
      setTextModelProgress(progress);
      setTextModelStage(stage);
      setTextModelProgressDetails(details ?? { loaded: 0, total: 0 });
    })
      .then((vector) => {
        if (!didCancel) {
          setTextVector(vector);
          setTextVectorQuery(queryText);
          setTextModelProgress(100);
          setTextModelStage("Search model ready");
          setTextModelProgressDetails({ loaded: 0, total: 0 });
        }
      })
      .catch((err) => {
        if (!didCancel) {
          console.error("Failed to encode semantic search text", err);
          setTextVector(null);
          setTextVectorError("Semantic search is unavailable right now.");
          setTextModelProgressDetails({ loaded: 0, total: 0 });
        }
      })
      .finally(() => {
        if (!didCancel) {
          setIsTextVectorLoading(false);
        }
      });

    return () => {
      didCancel = true;
    };
  }, [needsTextVector, trimmedQuery]);

  const reactQuery = useInfiniteQuery({
    queryKey: [
      "results",
      {
        debouncedSearchQuery,
        similarPath,
        searchMode,
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
          path: similarPath,
          pageSize: PAGE_SIZE,
          page: pageParam,
        });
      }

      if (searchMode === "semantic" && textVector && hasCurrentTextVector) {
        return await fetchSemanticResults({
          database,
          textQuery: trimmedQuery,
          textVector,
          pageSize: PAGE_SIZE,
          page: pageParam,
        });
      }

      if (searchMode === "hybrid" && textVector && hasCurrentTextVector) {
        return await fetchHybridResults({
          database,
          textQuery: trimmedQuery,
          keywordQuery,
          textVector,
          pageSize: PAGE_SIZE,
          page: pageParam,
        });
      }

      if (!hasSearchQuery) {
        return {
          data: [],
          prev: undefined,
          next: undefined,
        };
      }

      return await fetchResults({
        database,
        query: keywordQuery,
        pageSize: PAGE_SIZE,
        page: pageParam,
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
        (lastPage.data.length === PAGE_SIZE ? lastPageParam + 1 : undefined)
      );
    },
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isSuccess,
    isFetching,
    isPlaceholderData,
  } = reactQuery;

  useEffect(() => {
    if (!hasHydratedFromUrl) {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    searchParams.delete("q");
    searchParams.delete("similar");
    searchParams.delete("mode");

    if (similarPath) {
      searchParams.set("similar", similarPath);
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
  }, [debouncedSearchQuery, hasHydratedFromUrl, searchMode, similarPath]);

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

  const [tags, setTags] = useState<Tag[]>([]);
  const [recentVisibleCount, setRecentVisibleCount] = useState<number>(
    RECENT_ROW_INITIAL_SIZE,
  );
  const [recentResults, setRecentResults] = useState<SearchResultRow[]>([]);
  const [randomResults, setRandomResults] = useState<SearchResultRow[]>([]);
  const [hasMoreRandomResults, setHasMoreRandomResults] =
    useState<boolean>(true);
  const [randomAutoLoadCount, setRandomAutoLoadCount] = useState<number>(0);
  const [isRandomSimilarLoading, setIsRandomSimilarLoading] =
    useState<boolean>(false);
  const [isRecentLoading, setIsRecentLoading] = useState<boolean>(false);
  const [isRandomResultsLoading, setIsRandomResultsLoading] =
    useState<boolean>(false);
  const [randomExploreError, setRandomExploreError] = useState<string | null>(
    null,
  );
  const [randomResultsError, setRandomResultsError] = useState<string | null>(
    null,
  );
  const [recentExploreError, setRecentExploreError] = useState<string | null>(
    null,
  );
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
      setRecentResults([]);
      setRecentExploreError(null);
      return;
    }

    let didCancel = false;
    setIsRecentLoading(true);
    setRecentExploreError(null);

    fetchRecentResults({ database, pageSize: recentVisibleCount })
      .then((results) => {
        if (!didCancel) {
          setRecentResults(results);
        }
      })
      .catch((err) => {
        if (!didCancel) {
          console.error(err);
          setRecentExploreError("Couldn't load recent photos right now.");
        }
      })
      .finally(() => {
        if (!didCancel) {
          setIsRecentLoading(false);
        }
      });

    return () => {
      didCancel = true;
    };
  }, [database, recentVisibleCount]);

  useEffect(() => {
    if (!database) {
      setRandomResults([]);
      setRandomResultsError(null);
      return;
    }

    let didCancel = false;
    setHasMoreRandomResults(true);
    setRandomAutoLoadCount(0);
    setIsRandomResultsLoading(true);
    setRandomResultsError(null);

    fetchRandomResults({ database, pageSize: RANDOM_ROW_INITIAL_SIZE })
      .then((results) => {
        if (!didCancel) {
          setRandomResults(results);
          setHasMoreRandomResults(results.length === RANDOM_ROW_INITIAL_SIZE);
        }
      })
      .catch((err) => {
        if (!didCancel) {
          console.error(err);
          setRandomResultsError("Couldn't load random photos right now.");
        }
      })
      .finally(() => {
        if (!didCancel) {
          setIsRandomResultsLoading(false);
        }
      });

    return () => {
      didCancel = true;
    };
  }, [database]);

  const loadMoreRandomResults = useCallback(
    async (trigger: "manual" | "auto" = "manual") => {
      if (!database || isRandomResultsLoading) {
        return;
      }

      setIsRandomResultsLoading(true);
      setRandomResultsError(null);

      try {
        const results = await fetchRandomResults({
          database,
          pageSize: RANDOM_ROW_LOAD_MORE_SIZE,
          excludePaths: randomResults.map((result) => result.path),
        });

        setRandomResults((prev) => [...prev, ...results]);
        setHasMoreRandomResults(results.length === RANDOM_ROW_LOAD_MORE_SIZE);
        if (trigger === "auto") {
          setRandomAutoLoadCount((prev) => prev + 1);
        }
      } catch (err) {
        console.error(err);
        setRandomResultsError("Couldn't load random photos right now.");
      } finally {
        setIsRandomResultsLoading(false);
      }
    },
    [database, isRandomResultsLoading, randomResults],
  );

  const normalizedTags = useMemo(() => dedupeTags(tags), [tags]);
  const normalizedSearchTerms = useMemo(
    () =>
      searchQuery.map((term) => term.trim().toLowerCase()).filter(Boolean),
    [searchQuery],
  );
  const normalizedDebouncedSearchTerms = useMemo(
    () =>
      debouncedSearchQuery
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean),
    [debouncedSearchQuery],
  );
  const normalizedDebouncedSearchTermsKey =
    normalizedDebouncedSearchTerms.join("|");
  const normalizedSearchTermsKey = normalizedSearchTerms.join("|");
  const normalizedTagNames = useMemo(
    () => normalizedTags.map((tag) => tag.name),
    [normalizedTags],
  );
  const normalizedTagNamesKey = normalizedTagNames.join("|");
  const breadcrumbEntries = similarTrail.map((item, idx, trail) => ({
    ...item,
    path: item.path,
    idx,
    key: `${item.path}::${
      trail.slice(0, idx).filter((candidate) => candidate.path === item.path)
        .length
    }`,
  }));
  const similarClickstreamPaths = new Set([
    ...similarTrail.map((item) => item.path),
    ...(similarPath ? [similarPath] : []),
  ]);
  const isEmptyState = !isSimilarMode && searchInputValue.trim() === "";
  const queryResults = data?.pages.flatMap((page) => page.data);
  const canClear = isSimilarMode || searchInputValue.trim() !== "";
  const [refinementCounts, setRefinementCounts] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    if (
      !isEmptyState ||
      !hasMoreRandomResults ||
      isRandomResultsLoading ||
      randomAutoLoadCount >= 50
    ) {
      return;
    }

    const button = randomLoadMoreButtonRef.current;

    if (!button || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;

        if (!entry?.isIntersecting) {
          return;
        }

        observer.disconnect();
        void loadMoreRandomResults("auto");
      },
      {
        rootMargin: "160px 0px",
        threshold: 0.1,
      },
    );

    observer.observe(button);

    return () => {
      observer.disconnect();
    };
  }, [
    hasMoreRandomResults,
    isEmptyState,
    isRandomResultsLoading,
    loadMoreRandomResults,
    randomAutoLoadCount,
    randomResults.length,
  ]);

  useEffect(() => {
    if (
      !database ||
      isSimilarMode ||
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
    normalizedDebouncedSearchTerms,
    normalizedDebouncedSearchTermsKey,
    normalizedTagNames,
    normalizedTagNamesKey,
  ]);

  useSafeLayoutEffect(() => {
    if (!similarPath) {
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
  }, [similarPath]);

  useSafeLayoutEffect(() => {
    const nextPositions: Record<string, DOMRect> = {};

    const animateIntoPlace = (
      element: HTMLDivElement,
      startingTransform: string,
    ) => {
      element.style.transition = "none";
      element.style.transform = startingTransform;
      void element.getBoundingClientRect();

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          element.style.removeProperty("transition");
          element.style.removeProperty("transform");
        });
      });
    };

    breadcrumbEntries.forEach((entry) => {
      const element = breadcrumbRefs.current[entry.key];

      if (!element) {
        return;
      }

      const currentPosition = element.getBoundingClientRect();
      const previousPosition = breadcrumbPositionsRef.current[entry.key];

      nextPositions[entry.key] = currentPosition;

      if (!previousPosition) {
        animateIntoPlace(element, "translateX(-14px)");
        return;
      }

      const deltaX = previousPosition.left - currentPosition.left;

      if (Math.abs(deltaX) < 1) {
        return;
      }

      animateIntoPlace(element, `translateX(${deltaX}px)`);
    });

    breadcrumbPositionsRef.current = nextPositions;
  }, [breadcrumbEntries.map((entry) => entry.key).join("|")]);

  const applySearchTerms = (terms: string[]) => {
    setSimilarPath(null);
    setSimilarTrail([]);
    setRandomExploreError(null);
    setSearchInputValue(terms.join(","));
  };

  const clearSearchState = () => {
    setSearchInputValue("");
    setSimilarPath(null);
    setSimilarTrail([]);
  };

  const truncateSimilarStack = (breadcrumbIndex: number) => {
    setSimilarTrail((prev) => {
      const nextCurrentPath =
        breadcrumbIndex > 0 ? (prev[breadcrumbIndex - 1]?.path ?? null) : null;
      setSimilarPath(nextCurrentPath);
      return breadcrumbIndex > 1 ? prev.slice(0, breadcrumbIndex - 1) : [];
    });
  };

  const startSimilarSearch = (path: string) => {
    clearSearchState();
    setSimilarPath(path);
  };

  const loadRandomSimilarTrail = async () => {
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
  };

  return (
    <div className={styles.searchWidget}>
      <div className={styles.browseActionsBar}>
        <div className={styles.exploreActions}>
          <button
            type="button"
            className={styles.exploreAction}
            aria-label="Random similarity trail"
            onClick={loadRandomSimilarTrail}
            disabled={!database || isRandomSimilarLoading}
          >
            {isRandomSimilarLoading
              ? "Picking a random photo..."
              : "🎲 Random similarity trail"}
          </button>
          <Link
            href="/map"
            prefetch={false}
            className={styles.secondaryAction}
            aria-label="Explore the map"
            onClick={(event) => {
              forceDocumentNavigation(event, "/map");
            }}
          >
            🗺️ Explore the map
          </Link>
          <Link
            href="/slideshow"
            prefetch={false}
            className={styles.secondaryAction}
            aria-label="Open slideshow"
            onClick={(event) => {
              forceDocumentNavigation(event, "/slideshow");
            }}
          >
            🖼️ Open slideshow
          </Link>
        </div>

        {randomExploreError ? (
          <div className={styles.inlineError}>{randomExploreError}</div>
        ) : null}
      </div>

      <div className={styles.searchInputRow}>
        <div className={styles.searchInputContainer}>
          <input
            suppressHydrationWarning
            type="text"
            value={searchInputValue}
            placeholder="Type / to search (try 'cat at night', 'white', 'mavica')"
            spellCheck={false}
            autoFocus
            onChange={(ev) => {
              applySearchTerms(ev.target.value.split(","));
            }}
            ref={inputRef}
            tabIndex={0}
            title={
              props.disabled || !database
                ? "Disabled: the SQLite WASM failed to load, your browser does not support service workers, or the server is missing the proper COEP/COOP headers"
                : undefined
            }
          />
          {canClear ? (
            <button
              className={styles.clearButton}
              onClick={() => {
                clearSearchState();
              }}
              title="Clear search"
              type="button"
            >
              ×
            </button>
          ) : null}
        </div>

        {!isSimilarMode ? (
          <label className={styles.searchModeSelectLabel}>
            <select
              className={styles.searchModeSelect}
              aria-label="Search mode"
              value={searchMode}
              onChange={(event) => {
                setSearchMode(event.target.value as SearchMode);
              }}
            >
              <option value="keyword">Keyword search</option>
              <option value="semantic">Semantic search</option>
              <option value="hybrid">Hybrid search</option>
            </select>
            <span
              className={styles.searchModeInfo}
              aria-label="Search mode help"
              title="Keyword search matches indexed terms. Semantic search matches visual meaning using embeddings. Hybrid search fuses both rankings."
            >
              ⓘ
            </span>
          </label>
        ) : null}

        {isSuccess &&
        !isFetching &&
        !isSimilarMode &&
        searchMode === "keyword" &&
        trimmedQuery.length < 3 &&
        queryResults?.length === 0 ? (
          <div className={styles.searchHintInline}>
            Type a minimum of 3 characters
          </div>
        ) : null}
      </div>

      {!isSimilarMode && searchMode !== "keyword" && textModelProgress < 100 ? (
        <div className={styles.searchModeStatus}>
          <ProgressBar
            progress={textModelProgress}
            details={textModelProgressDetails}
          />
          <div>{textModelStage}</div>
        </div>
      ) : null}

      {!isSimilarMode && textVectorError ? (
        <div className={styles.inlineError}>{textVectorError}</div>
      ) : null}

      {isEmptyState ? (
        <section className={styles.emptyState} aria-label="Explore browse mode">
          <div className={styles.emptySections}>
            <section className={styles.sectionSurface}>
              <div className={styles.emptyTagsCaption}>
                <SharedTagsCaption />
              </div>
              <ProgressBar
                progress={progress}
                details={databaseProgressDetails}
              />
              <div className={styles.tagsContainer}>
                {normalizedTags.map((tag) => {
                  return (
                    <SearchTag
                      key={tag.name}
                      tag={tag.name}
                      count={tag.count - 1}
                      isActive={false}
                      onClick={(tagName) => {
                        applySearchTerms([tagName]);
                      }}
                    />
                  );
                })}
              </div>
            </section>

            <section className={styles.sectionSurface}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Recent additions</h3>
              </div>

              {isRecentLoading ? (
                <div className={styles.sectionStatus}>
                  Loading recent photos...
                </div>
              ) : null}

              {recentExploreError ? (
                <div className={styles.inlineError}>{recentExploreError}</div>
              ) : null}

              {!isRecentLoading &&
              !recentExploreError &&
              recentResults.length === 0 ? (
                <div className={styles.sectionStatus}>
                  No dated photos available yet.
                </div>
              ) : null}

              {recentResults.length > 0 ? (
                <ul className={styles.results}>
                  {recentResults.map((result) => {
                    return (
                      <li key={result.path} className={styles.resultLi}>
                        <SearchResultTile
                          result={result}
                          onFindSimilar={(path) => {
                            startSimilarSearch(path);
                          }}
                        />
                      </li>
                    );
                  })}
                  {recentResults.length >= recentVisibleCount ? (
                    <button
                      className={styles.moreButton}
                      onClick={() => {
                        setRecentVisibleCount(
                          (prev) => prev + RECENT_ROW_LOAD_MORE_SIZE,
                        );
                      }}
                      disabled={isRecentLoading}
                    >
                      {isRecentLoading ? (
                        <>Loading&hellip;</>
                      ) : (
                        <>More&hellip;</>
                      )}
                    </button>
                  ) : null}
                </ul>
              ) : null}
            </section>

            <section className={styles.sectionSurface}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Random selection</h3>
              </div>

              {isRandomResultsLoading ? (
                <div className={styles.sectionStatus}>
                  Loading random photos...
                </div>
              ) : null}

              {randomResultsError ? (
                <div className={styles.inlineError}>{randomResultsError}</div>
              ) : null}

              {!isRandomResultsLoading &&
              !randomResultsError &&
              randomResults.length === 0 ? (
                <div className={styles.sectionStatus}>
                  No random photos available yet.
                </div>
              ) : null}

              {randomResults.length > 0 ? (
                <ul className={styles.results}>
                  {randomResults.map((result) => {
                    return (
                      <li key={result.path} className={styles.resultLi}>
                        <SearchResultTile
                          result={result}
                          onFindSimilar={(path) => {
                            startSimilarSearch(path);
                          }}
                        />
                      </li>
                    );
                  })}
                  {hasMoreRandomResults ? (
                    <button
                      ref={randomLoadMoreButtonRef}
                      className={styles.moreButton}
                      onClick={() => {
                        void loadMoreRandomResults("manual");
                      }}
                      disabled={isRandomResultsLoading}
                    >
                      {isRandomResultsLoading ? (
                        <>Loading&hellip;</>
                      ) : (
                        <>More&hellip;</>
                      )}
                    </button>
                  ) : null}
                </ul>
              ) : null}
            </section>
          </div>
        </section>
      ) : null}

      {!isEmptyState ? (
        <section>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionCaption}>
              <SharedTagsCaption />
            </div>
          </div>
          <ProgressBar progress={progress} details={databaseProgressDetails} />
          <div className={styles.tagsContainer}>
            {normalizedTags.map((tag) => {
              const isActive = normalizedSearchTerms.includes(tag.name);
              const refinementCount = refinementCounts[tag.name];
              const isDisabled = !isActive && refinementCount === 0;
              const visibleCount =
                !isActive && refinementCount !== undefined
                  ? refinementCount
                  : tag.count - 1;
              return (
                <SearchTag
                  key={tag.name}
                  tag={tag.name}
                  count={visibleCount}
                  isActive={isActive}
                  disabled={isDisabled}
                  onClick={() => {
                    setSimilarPath(null);
                    setSimilarTrail([]);
                    setRandomExploreError(null);
                    setSearchInputValue((prev) => {
                      const nextTerms = parseSearchTerms(prev);
                      const updatedTerms = isActive
                        ? nextTerms.filter(
                            (term) =>
                              term && term.trim().toLowerCase() !== tag.name,
                          )
                        : [...nextTerms.filter((term) => term), tag.name];
                      return updatedTerms.join(",");
                    });
                  }}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {isSimilarMode ? (
        <div className={styles.modeBar}>
          <div className={styles.modeStack}>
            <div className={styles.modeSource} ref={modeSourceRef}>
              <div className={styles.modeSourceItem}>
                {similarPreviewSrc ? (
                  <img
                    className={styles.modeSourcePreview}
                    src={similarPreviewSrc}
                    alt={`Source photo ${similarFilename ?? ""}`}
                  />
                ) : null}
                <a
                  className={styles.modeSourceSlideshowButton}
                  href={`/slideshow?mode=similar&seed=${encodeURIComponent(similarPath ?? "")}`}
                  aria-label="Start similarity trail slideshow"
                  title="Start similarity trail slideshow"
                  onClick={(event) =>
                    forceDocumentNavigation(
                      event,
                      `/slideshow?mode=similar&seed=${encodeURIComponent(similarPath ?? "")}`,
                    )
                  }
                >
                  🖼️
                </a>
                <button
                  type="button"
                  className={styles.breadcrumbRemoveButton}
                  onClick={() => {
                    truncateSimilarStack(similarTrail.length);
                  }}
                  aria-label="Clear current similarity selection"
                  title="Clear similarity selection"
                >
                  ×
                </button>
              </div>
              {similarTrail.length > 0 ? (
                <div className={styles.modeArrow} aria-hidden="true">
                  →
                </div>
              ) : null}
            </div>
            {similarTrail.length > 0 ? (
              <div
                className={styles.breadcrumbs}
                aria-label="Similarity breadcrumbs"
              >
                {[...breadcrumbEntries].reverse().map((entry) => {
                  const { path, idx, key, similarity } = entry;
                  const label = path.split("/").at(-1) ?? path;
                  const opacity =
                    0.35 + (0.55 * (idx + 1)) / similarTrail.length;
                  const similarityLabel =
                    typeof similarity === "number"
                      ? `${Math.round(similarity * 100)}%`
                      : null;
                  const preview = (
                    <img
                      className={styles.breadcrumbPreview}
                      src={getResizedAlbumImageSrc(path)}
                      alt=""
                    />
                  );

                  return (
                    <div
                      key={key}
                      className={styles.breadcrumbItem}
                      style={{ opacity }}
                      ref={(element) => {
                        breadcrumbRefs.current[key] = element;
                      }}
                    >
                      <a
                        className={styles.breadcrumbButton}
                        href={getAlbumAnchorHref(path)}
                        title={`Open ${label}`}
                        aria-label={label}
                      >
                        {preview}
                        {similarityLabel ? (
                          <span className={styles.breadcrumbSimilarity}>
                            {similarityLabel}
                          </span>
                        ) : null}
                      </a>
                      <button
                        type="button"
                        className={styles.breadcrumbRemoveButton}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          truncateSimilarStack(idx);
                        }}
                        aria-label={`Remove ${label} from breadcrumbs`}
                        title={`Remove ${label} and newer selections`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div>
        <ul className={styles.results}>
          {isSimilarMode || searchInputValue.trim().length > 0 ? (
            <>
              {isSuccess &&
              !isFetching &&
              queryResults?.length === 0 &&
              isSimilarMode ? (
                <div>
                  No similar results for <i>{similarPath?.split("/").at(-1)}</i>
                </div>
              ) : null}

              {isSuccess &&
              !isFetching &&
              queryResults?.length === 0 &&
              !isSimilarMode &&
              trimmedQuery.length >= 3 ? (
                <div>
                  No results for <i>{trimmedQuery}</i>
                </div>
              ) : null}

              {queryResults?.map((r) => {
                const isVisitedInSimilarTrail =
                  isSimilarMode && similarClickstreamPaths.has(r.path);
                return (
                  <li
                    key={r.path}
                    className={styles.resultLi}
                    style={{
                      filter: [
                        isPlaceholderData ? "saturate(0.5)" : "saturate(1)",
                        isVisitedInSimilarTrail ? "grayscale(1)" : "",
                      ]
                        .filter(Boolean)
                        .join(" "),
                      opacity: isVisitedInSimilarTrail ? 0.55 : 1,
                    }}
                  >
                    <SearchResultTile
                      result={r}
                      onFindSimilar={(path, similarity) => {
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
                      }}
                    />
                  </li>
                );
              })}

              {hasNextPage && isSuccess ? (
                <button
                  className={styles.moreButton}
                  onClick={() => {
                    fetchNextPage();
                  }}
                  disabled={isFetching}
                >
                  {isFetching ? <>Loading&hellip;</> : <>More&hellip;</>}
                </button>
              ) : null}

              {isFetching && !isSuccess ? <div>Searching&hellip;</div> : null}
            </>
          ) : null}
        </ul>
      </div>
    </div>
  );
};

export default Search;
