import React, { useCallback, useEffect, useRef, useState } from "react";
import { Database } from "@sqlite.org/sqlite-wasm";
import styles from "./Search.module.css";
import { fetchRecentResults, fetchRandomResults } from "./api";
import { SearchResultRow } from "./searchTypes";
import { SearchResultTile } from "./SearchResultTile";
import { SearchTag } from "./SearchTag";
import { ProgressBar } from "../ProgressBar";

const RECENT_ROW_INITIAL_SIZE = 15;
const RECENT_ROW_LOAD_MORE_SIZE = 16;
const RANDOM_ROW_INITIAL_SIZE = 7;
const RANDOM_ROW_LOAD_MORE_SIZE = 8;

type Tag = {
  name: string;
  count: number;
};

type ProgressDetails = {
  loaded: number;
  total: number;
};

type Props = {
  database: Database | null;
  progress: number;
  databaseProgressDetails: ProgressDetails;
  normalizedTags: Tag[];
  onApplySearchTerms: (terms: string[]) => void;
  onStartSimilarSearch: (path: string) => void;
};

export const EmptyStateExplore: React.FC<Props> = ({
  database,
  progress,
  databaseProgressDetails,
  normalizedTags,
  onApplySearchTerms,
  onStartSimilarSearch,
}) => {
  const [recentVisibleCount, setRecentVisibleCount] = useState<number>(
    RECENT_ROW_INITIAL_SIZE,
  );
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

  return (
    <section className={styles.emptyState} aria-label="Explore browse mode">
      <div className={styles.emptySections}>
        <section className={styles.sectionSurface}>
          <div className={styles.emptyTagsCaption}>
            keep stacking keywords to narrow results, or click{" "}
            <span style={{ filter: "grayscale(100%)" }}>🔍</span> to find
            similar photos
          </div>
          <ProgressBar progress={progress} details={databaseProgressDetails} />
          <div className={styles.tagsContainer}>
            {normalizedTags.map((tag) => {
              return (
                <SearchTag
                  key={tag.name}
                  tag={tag.name}
                  count={tag.count - 1}
                  isActive={false}
                  onClick={(tagName) => {
                    onApplySearchTerms([tagName]);
                  }}
                />
              );
            })}
          </div>
        </section>

        <section className={styles.sectionSurface}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Latest</h3>
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
