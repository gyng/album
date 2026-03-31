import React, { useCallback, useEffect, useRef, useState } from "react";
import { Database } from "@sqlite.org/sqlite-wasm";
import Link from "next/link";
import styles from "./Search.module.css";
import commonStyles from "../../styles/common.module.css";
import { Thumb } from "../Thumb";
import { fetchMemoryCandidates, fetchRecentResults, fetchRandomResults } from "./api";
import { SearchResultRow } from "./searchTypes";
import { SearchResultTile } from "./SearchResultTile";
import { ProgressBar } from "../ProgressBar";
import {
  formatMemoryDateRange,
  getMemoryClusters,
  ResolvedMemoryCluster,
} from "../../util/clusterByDate";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";
import { parseColorPalette, rgbToString } from "../../util/colorDistance";

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
  return `/timeline?${params.toString()}`;
};

type ProgressDetails = {
  loaded: number;
  total: number;
};

type MemoryResult = SearchResultRow & {
  date: string;
  isoDate: string;
};

type Props = {
  database: Database | null;
  progress: number;
  databaseProgressDetails: ProgressDetails;
  onStartSimilarSearch: (path: string) => void;
};

export const EmptyStateExplore: React.FC<Props> = ({
  database,
  progress,
  databaseProgressDetails,
  onStartSimilarSearch,
}) => {
  const [recentVisibleCount, setRecentVisibleCount] = useState<number>(
    RECENT_ROW_INITIAL_SIZE,
  );
  const [todayDate] = useState<string>(() => {
    const date = new Date();
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
  const [memoryClusters, setMemoryClusters] = useState<
    ResolvedMemoryCluster<MemoryResult>[]
  >([]);
  const [visibleMemoryClusterCount, setVisibleMemoryClusterCount] =
    useState<number>(MEMORY_CLUSTER_INITIAL_SIZE);
  const [isMemoriesLoading, setIsMemoriesLoading] = useState<boolean>(false);
  const [recentResults, setRecentResults] = useState<SearchResultRow[]>([]);
  const [isRecentLoading, setIsRecentLoading] = useState<boolean>(false);
  const [recentExploreError, setRecentExploreError] = useState<string | null>(
    null,
  );
  const [randomResults, setRandomResults] = useState<SearchResultRow[]>([]);
  const [hasMoreRandomResults, setHasMoreRandomResults] =
    useState<boolean>(true);
  const [randomAutoLoadCount, setRandomAutoLoadCount] = useState<number>(0);
  const [isRandomResultsLoading, setIsRandomResultsLoading] =
    useState<boolean>(false);
  const [randomResultsError, setRandomResultsError] = useState<string | null>(
    null,
  );
  const randomLoadMoreButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!database) {
      setMemoryClusters([]);
      setVisibleMemoryClusterCount(MEMORY_CLUSTER_INITIAL_SIZE);
      return;
    }

    let didCancel = false;
    setIsMemoriesLoading(true);
    setVisibleMemoryClusterCount(MEMORY_CLUSTER_INITIAL_SIZE);

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

        setMemoryClusters(resolved);
      })
      .catch((err) => {
        if (!didCancel) {
          console.error(err);
          setMemoryClusters([]);
        }
      })
      .finally(() => {
        if (!didCancel) {
          setIsMemoriesLoading(false);
        }
      });

    return () => {
      didCancel = true;
    };
  }, [database, todayDate]);

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

  useEffect(() => {
    if (
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

  const getMemoryThumbnailColor = useCallback((result: MemoryResult) => {
    const firstColor = parseColorPalette(result.colors)[0];
    return firstColor ? rgbToString(firstColor) : "rgba(255, 255, 255, 0.2)";
  }, []);
  const visibleMemoryClusters = memoryClusters.slice(
    0,
    visibleMemoryClusterCount,
  );

  return (
    <section className={styles.emptyState} aria-label="Explore browse mode">
      <div className={styles.emptySections}>
        {progress < 100 && (
          <section className={styles.sectionSurface}>
            <ProgressBar progress={progress} details={databaseProgressDetails} />
          </section>
        )}

        <section className={styles.sectionSurface}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Latest</h3>
          </div>

          {isRecentLoading || isMemoriesLoading ? (
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
                        onStartSimilarSearch(path);
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
                  {isRecentLoading ? <>Loading&hellip;</> : <>More&hellip;</>}
                </button>
              ) : null}
            </ul>
          ) : null}
        </section>

        {visibleMemoryClusters.length > 0 ? (
          <section className={styles.sectionSurface}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>On this day</h3>
            </div>

            <div className={styles.memoryClusters}>
              {visibleMemoryClusters.map((cluster) => {
                const albumLabel = getClusterAlbumLabel(cluster.items);
                const previewItems = cluster.items.slice(
                  0,
                  MEMORY_CLUSTER_ITEM_PREVIEW_SIZE,
                );
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
                      <h4 className={styles.memoryClusterLabel}>
                        {[
                          `${cluster.yearsAgo} year${cluster.yearsAgo === 1 ? "" : "s"} ago`,
                          ...meta,
                        ].join(" · ")}
                      </h4>
                    </div>

                    <ul className={styles.memoryClusterStrip}>
                      {previewItems.map((result) => (
                        <li key={result.path} className={styles.memoryClusterItem}>
                          <Link
                            href={result.album_relative_path}
                            className={styles.memoryThumbLink}
                            aria-label={result.snippet || result.filename}
                          >
                            <Thumb
                              src={getResizedAlbumImageSrc(result.path)}
                              alt={result.snippet || result.filename}
                              style={{
                                backgroundColor: getMemoryThumbnailColor(result),
                              }}
                            />
                          </Link>
                        </li>
                      ))}
                      <li className={styles.memoryClusterItem}>
                        <Link
                          href={buildTimelineMemoryHref(
                            cluster.startDate,
                            albumLabel,
                          )}
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
                className={`${commonStyles.button} ${styles.memoryLoadMoreButton}`}
                onClick={() => {
                  setVisibleMemoryClusterCount((current) =>
                    Math.min(
                      current + MEMORY_CLUSTER_LOAD_MORE_SIZE,
                      memoryClusters.length,
                    ),
                  );
                }}
              >
                More memories…
              </button>
            ) : null}
          </section>
        ) : null}

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
                        onStartSimilarSearch(path);
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
  );
};
