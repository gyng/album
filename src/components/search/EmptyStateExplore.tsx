import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Database } from "@sqlite.org/sqlite-wasm";
import { AppLink as Link } from "../platform";
import sharedStyles from "./Search.module.css";
import localStyles from "./EmptyStateExplore.module.css";
import { Heading, buttonStyles } from "../ui";
import { fetchMemoryCandidates, fetchRecentResults, fetchRandomResults } from "./api";
import { SearchResultRow } from "./searchTypes";
import { SearchResultTile, SearchResultTilePlaceholder } from "./SearchResultTile";
import {
  formatMemoryDateRange,
  getMemoryClusters,
  ResolvedMemoryCluster,
} from "../../util/clusterByDate";
import { RGB } from "../../util/colorDistance";

const styles = mergeCssModuleStyles(sharedStyles, localStyles, [
  "emptySections",
  "emptyState",
  "memoryClusterCard",
  "memoryClusterHeader",
  "memoryClusterItem",
  "memoryClusterLabel",
  "memoryClusterStrip",
  "memoryClusters",
  "memoryLoadMoreButton",
  "memoryTimelineTile",
  "sectionSurface",
]);

const RECENT_ROW_INITIAL_SIZE = 15;
const RECENT_ROW_LOAD_MORE_SIZE = 16;
const RANDOM_ROW_INITIAL_SIZE = 7;
const RANDOM_ROW_LOAD_MORE_SIZE = 8;
const MEMORY_CLUSTER_INITIAL_SIZE = 2;
const MEMORY_CLUSTER_ITEM_PREVIEW_SIZE = 4;
const MEMORY_CLUSTER_LOAD_MORE_SIZE = 2;

const buildTimelineMemoryHref = (date: string, album?: string | null) => {
  const params = new URLSearchParams({ date });
  if (album) {
    params.set("filter_album", album);
  }
  return `/explore/timeline?${params.toString()}`;
};

type MemoryResult = SearchResultRow & {
  date: string;
  isoDate: string;
};

type Props = {
  database: Database | null;
  onStartSimilarSearch: (path: string) => void;
  onSearchByColor?: (color: RGB) => void;
  isColorCategoryActive?: boolean;
};

const EMPTY_RESULTS: SearchResultRow[] = [];
const EMPTY_MEMORY_CLUSTERS: ResolvedMemoryCluster<MemoryResult>[] = [];

/**
 * A grid's first page, held open until its rows arrive: one line of status
 * text growing into rows of photographs pushed everything below it — the next
 * section, and on a phone the whole page — down as the database answered. The
 * page counts include the "More…" tile that follows a full page.
 */
const LoadingGrid = ({ label, tiles }: { label: string; tiles: number }) => (
  <>
    <div className={styles.visuallyHidden} role="status">
      {label}
    </div>
    <ul className={styles.results} aria-hidden="true">
      {Array.from({ length: tiles }, (_, index) => (
        <li key={index}>
          <SearchResultTilePlaceholder />
        </li>
      ))}
    </ul>
  </>
);

export const EmptyStateExplore: React.FC<Props> = ({
  database,
  onStartSimilarSearch,
  onSearchByColor,
  isColorCategoryActive = false,
}) => {
  const [recentVisibleCount, setRecentVisibleCount] = useState<number>(RECENT_ROW_INITIAL_SIZE);
  const [todayDate] = useState<string>(() => {
    const date = new Date();
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
  // Each section's result belongs to the request it answered: a section is
  // loading until its current request has answered, and keeps showing what it
  // had meanwhile, so a larger page or another day does not blank it first.
  const memoryRequest = useMemo(() => ({ database, todayDate }), [database, todayDate]);
  const [memories, setMemories] = useState<{
    request: object;
    clusters: ResolvedMemoryCluster<MemoryResult>[];
  } | null>(null);
  const memoryClusters = database && memories ? memories.clusters : EMPTY_MEMORY_CLUSTERS;
  const isMemoriesLoading = Boolean(database) && memories?.request !== memoryRequest;
  // How many clusters are shown, for this request only: a new one starts from the first few.
  const [memoryShown, setMemoryShown] = useState<{ request: object | null; count: number }>({
    request: null,
    count: MEMORY_CLUSTER_INITIAL_SIZE,
  });
  const visibleMemoryClusterCount =
    memoryShown.request === memoryRequest ? memoryShown.count : MEMORY_CLUSTER_INITIAL_SIZE;

  const recentRequest = useMemo(
    () => ({ database, pageSize: recentVisibleCount }),
    [database, recentVisibleCount],
  );
  const [recent, setRecent] = useState<{ request: object; results: SearchResultRow[] } | null>(
    null,
  );
  const [recentFailedRequest, setRecentFailedRequest] = useState<object | null>(null);
  const recentResults = database && recent ? recent.results : EMPTY_RESULTS;
  const recentExploreError =
    recentFailedRequest === recentRequest ? "Couldn't load recent photos right now." : null;
  const isRecentLoading =
    Boolean(database) && recent?.request !== recentRequest && recentFailedRequest !== recentRequest;

  const randomRequest = useMemo(() => ({ database }), [database]);
  const [random, setRandom] = useState<{
    request: object;
    results: SearchResultRow[];
    hasMore: boolean;
    autoLoads: number;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const currentRandom = random?.request === randomRequest ? random : null;
  const randomResults = !database
    ? EMPTY_RESULTS
    : (currentRandom?.results ?? random?.results ?? EMPTY_RESULTS);
  const hasMoreRandomResults = currentRandom?.hasMore ?? true;
  const randomAutoLoadCount = currentRandom?.autoLoads ?? 0;
  const isRandomResultsLoading = currentRandom ? currentRandom.loading : Boolean(database);
  const randomResultsError = currentRandom?.error ?? null;
  const randomLoadMoreButtonRef = useRef<HTMLButtonElement | null>(null);
  const randomLoadInFlightRef = useRef(false);

  useEffect(() => {
    if (!database) return;

    let didCancel = false;
    const request = memoryRequest;

    fetchMemoryCandidates({ database, todayDate })
      .then((results) => {
        if (didCancel) {
          return;
        }

        const resolved = getMemoryClusters(
          results.map((result) => ({
            ...result,
            date: result.isoDate,
          })),
          todayDate,
        );

        setMemories({ request, clusters: resolved });
      })
      .catch((err) => {
        if (!didCancel) {
          console.error(err);
          setMemories({ request, clusters: [] });
        }
      });

    return () => {
      didCancel = true;
    };
  }, [database, todayDate, memoryRequest]);

  useEffect(() => {
    if (!database) return;

    let didCancel = false;
    const request = recentRequest;

    fetchRecentResults({ database, pageSize: recentVisibleCount })
      .then((results) => {
        if (!didCancel) {
          setRecent({ request, results });
        }
      })
      .catch((err) => {
        if (!didCancel) {
          console.error(err);
          setRecentFailedRequest(request);
        }
      });

    return () => {
      didCancel = true;
    };
  }, [database, recentVisibleCount, recentRequest]);

  useEffect(() => {
    if (!database) return;

    let didCancel = false;
    const request = randomRequest;

    fetchRandomResults({ database, pageSize: RANDOM_ROW_INITIAL_SIZE })
      .then((results) => {
        if (!didCancel) {
          setRandom({
            request,
            results,
            hasMore: results.length === RANDOM_ROW_INITIAL_SIZE,
            autoLoads: 0,
            loading: false,
            error: null,
          });
        }
      })
      .catch((err) => {
        if (!didCancel) {
          console.error(err);
          setRandom((previous) => ({
            request,
            results: previous?.results ?? [],
            hasMore: true,
            autoLoads: 0,
            loading: false,
            error: "Couldn't load random photos right now.",
          }));
        }
      });

    return () => {
      didCancel = true;
    };
  }, [database, randomRequest]);

  const loadMoreRandomResults = useCallback(
    async (trigger: "manual" | "auto" = "manual") => {
      if (randomLoadInFlightRef.current) {
        return;
      }

      // Only the current database's row grows; a load that outlives it is dropped.
      const update = (change: (current: NonNullable<typeof random>) => Partial<typeof current>) =>
        setRandom((previous) =>
          previous?.request === randomRequest ? { ...previous, ...change(previous) } : previous,
        );
      randomLoadInFlightRef.current = true;
      update(() => ({ loading: true, error: null }));

      try {
        const results = await fetchRandomResults({
          database: database!,
          pageSize: RANDOM_ROW_LOAD_MORE_SIZE,
          excludePaths: randomResults.map((result) => result.path),
        });

        update((current) => ({
          results: [...current.results, ...results],
          hasMore: results.length === RANDOM_ROW_LOAD_MORE_SIZE,
          autoLoads: current.autoLoads + (trigger === "auto" ? 1 : 0),
        }));
      } catch (err) {
        console.error(err);
        update(() => ({ error: "Couldn't load random photos right now." }));
      } finally {
        randomLoadInFlightRef.current = false;
        update(() => ({ loading: false }));
      }
    },
    [database, randomResults, randomRequest],
  );

  useEffect(() => {
    if (!hasMoreRandomResults || isRandomResultsLoading || randomAutoLoadCount >= 50) {
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
        // Two viewports ahead, so the next page is in place before the reader
        // gets there: appended within sight, it pushed the footer down under
        // them, and a fling on a phone covers one viewport faster than a page
        // loads.
        rootMargin: "200% 0px",
        threshold: 0.1,
      },
    );

    observer.observe(button);

    return () => {
      observer.disconnect();
    };
  }, [
    hasMoreRandomResults,
    isRandomResultsLoading,
    loadMoreRandomResults,
    randomAutoLoadCount,
    randomResults.length,
  ]);

  const getClusterAlbumLabel = useCallback((items: MemoryResult[]) => {
    const albums = Array.from(
      new Set(
        items
          .map((item) => {
            const match =
              item.album_relative_path.match(/^\/album\/([^#?/]+)/) ??
              item.path.match(/\/albums\/([^/]+)\//);
            return match?.[1] ?? null;
          })
          .filter(Boolean),
      ),
    );

    return albums.length === 1 ? albums[0] : null;
  }, []);

  const visibleMemoryClusters = memoryClusters.slice(0, visibleMemoryClusterCount);

  return (
    <section className={styles.emptyState} aria-label="Explore browse mode">
      <div className={styles.emptySections}>
        <section className={styles.sectionSurface}>
          <div className={styles.sectionHeader}>
            <Heading level={2} as="h3">
              Latest
            </Heading>
          </div>

          {/* Only while the grid is still empty: during a "More…"/refresh the
              existing tiles stay mounted and the load-more button carries its
              own "Loading…" label. */}
          {(!database || isRecentLoading || isMemoriesLoading) && recentResults.length === 0 ? (
            <LoadingGrid label="Loading recent photos…" tiles={RECENT_ROW_INITIAL_SIZE + 1} />
          ) : null}

          {recentExploreError ? (
            <div className={styles.inlineError}>{recentExploreError}</div>
          ) : null}

          {database && !isRecentLoading && !recentExploreError && recentResults.length === 0 ? (
            <div className={styles.sectionStatus}>No dated photos available yet.</div>
          ) : null}

          {recentResults.length > 0 ? (
            <ul className={styles.results}>
              {recentResults.map((result) => {
                return (
                  <li key={result.path} className={styles.resultLi}>
                    <SearchResultTile
                      result={result}
                      onFindSimilar={(path) => {
                        onStartSimilarSearch(path);
                      }}
                      {...(onSearchByColor ? { onSearchByColor } : {})}
                      persistColorAction={isColorCategoryActive}
                    />
                  </li>
                );
              })}
              {recentResults.length >= recentVisibleCount ? (
                <li>
                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={() => {
                      setRecentVisibleCount((prev) => prev + RECENT_ROW_LOAD_MORE_SIZE);
                    }}
                    disabled={isRecentLoading}
                  >
                    {isRecentLoading ? <>Loading&hellip;</> : <>More&hellip;</>}
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
        </section>

        {visibleMemoryClusters.length > 0 ? (
          <section className={styles.sectionSurface}>
            <div className={styles.sectionHeader}>
              <Heading level={2} as="h3">
                On this day
              </Heading>
            </div>

            <div className={styles.memoryClusters}>
              {visibleMemoryClusters.map((cluster) => {
                const albumLabel = getClusterAlbumLabel(cluster.items);
                const previewItems = cluster.items.slice(0, MEMORY_CLUSTER_ITEM_PREVIEW_SIZE);
                const meta = [
                  albumLabel,
                  formatMemoryDateRange(cluster.startDate, cluster.endDate),
                ].filter(Boolean);

                return (
                  <section
                    key={`${cluster.year}-${cluster.startDate}-${cluster.endDate}`}
                    className={styles.memoryClusterCard}
                    aria-label={meta.join(" · ")}
                  >
                    <div className={styles.memoryClusterHeader}>
                      <Heading level={3} as="h4" className={styles.memoryClusterLabel}>
                        {[
                          `${cluster.yearsAgo} year${cluster.yearsAgo === 1 ? "" : "s"} ago`,
                          ...meta,
                        ].join(" · ")}
                      </Heading>
                    </div>

                    <ul className={styles.memoryClusterStrip}>
                      {previewItems.map((result) => (
                        <li key={result.path} className={styles.memoryClusterItem}>
                          <SearchResultTile
                            result={result}
                            onFindSimilar={(path) => {
                              onStartSimilarSearch(path);
                            }}
                            {...(onSearchByColor ? { onSearchByColor } : {})}
                            persistColorAction={isColorCategoryActive}
                          />
                        </li>
                      ))}
                      <li className={styles.memoryClusterItem}>
                        <Link
                          href={buildTimelineMemoryHref(cluster.startDate, albumLabel)}
                          className={`${styles.moreButton} ${styles.memoryTimelineTile}`}
                        >
                          Open timeline
                        </Link>
                      </li>
                    </ul>
                  </section>
                );
              })}
            </div>

            {memoryClusters.length > visibleMemoryClusterCount ? (
              <button
                type="button"
                className={`${buttonStyles.base} ${styles.memoryLoadMoreButton}`}
                onClick={() => {
                  setMemoryShown((shown) => ({
                    request: memoryRequest,
                    count: Math.min(
                      (shown.request === memoryRequest
                        ? shown.count
                        : MEMORY_CLUSTER_INITIAL_SIZE) + MEMORY_CLUSTER_LOAD_MORE_SIZE,
                      memoryClusters.length,
                    ),
                  }));
                }}
              >
                More memories…
              </button>
            ) : null}
          </section>
        ) : null}

        {/* Only once everything above it has answered: "On this day" lands
            above this section and the latest grid can shrink from its
            placeholders, and on a wide screen this section is in view by then,
            so arriving earlier meant being moved under the reader. */}
        {database && !isMemoriesLoading && !isRecentLoading ? (
          <section className={styles.sectionSurface}>
            <div className={styles.sectionHeader}>
              <Heading level={2} as="h3">
                Random selection
              </Heading>
            </div>

            {/* Guarded like the recent section: the random grid auto-loads on
              scroll (IntersectionObserver), so nothing may appear above the
              mounted tiles on every extend. */}
            {(!database || isRandomResultsLoading) && randomResults.length === 0 ? (
              <LoadingGrid label="Loading random photos…" tiles={RANDOM_ROW_INITIAL_SIZE + 1} />
            ) : null}

            {randomResultsError ? (
              <div className={styles.inlineError}>{randomResultsError}</div>
            ) : null}

            {database &&
            !isRandomResultsLoading &&
            !randomResultsError &&
            randomResults.length === 0 ? (
              <div className={styles.sectionStatus}>No random photos available yet.</div>
            ) : null}

            {randomResults.length > 0 ? (
              <ul className={styles.results}>
                {randomResults.map((result) => {
                  return (
                    <li key={result.path} className={styles.resultLi}>
                      <SearchResultTile
                        result={result}
                        onFindSimilar={(path) => {
                          onStartSimilarSearch(path);
                        }}
                        {...(onSearchByColor ? { onSearchByColor } : {})}
                        persistColorAction={isColorCategoryActive}
                      />
                    </li>
                  );
                })}
                {hasMoreRandomResults ? (
                  <li>
                    <button
                      type="button"
                      ref={randomLoadMoreButtonRef}
                      className={styles.moreButton}
                      onClick={() => {
                        void loadMoreRandomResults();
                      }}
                      disabled={isRandomResultsLoading}
                    >
                      {isRandomResultsLoading ? <>Loading&hellip;</> : <>More&hellip;</>}
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </section>
  );
};
