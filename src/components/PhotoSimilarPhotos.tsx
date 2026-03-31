import React from "react";
import styles from "./Photo.module.css";
import {
  useDatabase,
  useEmbeddingsDatabase,
} from "./database/useDatabase";
import { fetchSimilarResults } from "./search/api";
import { SearchResultRow } from "./search/searchTypes";
import { SearchResultTile } from "./search/SearchResultTile";
import { Heading } from "./ui";

export const PhotoSimilarPhotos: React.FC<{
  path?: string | null;
  pageSize?: number;
}> = (props) => {
  const pageSize = props.pageSize ?? 8;
  const initialVisibleCount = Math.max(pageSize - 1, 1);
  const [database, progress] = useDatabase();
  const [embeddingsDatabase, embeddingsProgress] = useEmbeddingsDatabase(
    Boolean(props.path),
  );
  const [results, setResults] = React.useState<SearchResultRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [offset, setOffset] = React.useState(0);
  const [hasNextPage, setHasNextPage] = React.useState(false);
  const [isLoadingResults, setIsLoadingResults] = React.useState(false);

  React.useEffect(() => {
    setResults([]);
    setError(null);
    setOffset(0);
    setHasNextPage(false);
  }, [database, initialVisibleCount, props.path]);

  React.useEffect(() => {
    if (!database || !embeddingsDatabase || !props.path) {
      return;
    }

    let isCancelled = false;
    setIsLoadingResults(true);
    setError(null);

    fetchSimilarResults({
      database,
      embeddingsDatabase,
      path: props.path,
      page: 0,
      pageSize: offset === 0 ? initialVisibleCount : pageSize,
      offset,
    })
      .then((response) => {
        if (isCancelled) {
          return;
        }

        setResults((prev) =>
          offset === 0
            ? response.data
            : [
                ...prev,
                ...response.data.filter(
                  (row) => !prev.some((existing) => existing.path === row.path),
                ),
              ],
        );
        setHasNextPage(response.next != null);
      })
      .catch((err: unknown) => {
        if (isCancelled) {
          return;
        }

        console.error("Failed to load similar photos", err);
        setError("Could not load similar photos.");
      })
      .finally(() => {
        if (isCancelled) {
          return;
        }

        setIsLoadingResults(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [
    database,
    embeddingsDatabase,
    initialVisibleCount,
    offset,
    pageSize,
    props.path,
  ]);

  if (!props.path) {
    return null;
  }

  return (
    <section className={styles.similarPhotos} aria-live="polite">
      <Heading level={2} as="h3" className={styles.similarPhotosTitle}>Similar photos</Heading>

      {!database ? (
        <p className={styles.similarPhotosStatus}>
          Loading search index
          {progress > 0 ? ` (${Math.round(progress)}%)` : ""}…
        </p>
      ) : !embeddingsDatabase ? (
        <p className={styles.similarPhotosStatus}>
          Loading similarity index
          {embeddingsProgress > 0 ? ` (${Math.round(embeddingsProgress)}%)` : ""}
          …
        </p>
      ) : isLoadingResults && results.length === 0 ? (
        <p className={styles.similarPhotosStatus}>Finding similar photos…</p>
      ) : error ? (
        <p className={styles.similarPhotosStatus}>{error}</p>
      ) : results.length === 0 ? (
        <p className={styles.similarPhotosStatus}>
          No similar photos indexed for this image yet.
        </p>
      ) : (
        <div className={styles.similarPhotoGrid}>
          {results.map((result) => (
            <SearchResultTile key={result.path} result={result} />
          ))}
          <a
            href={`/search?similar=${encodeURIComponent(props.path)}`}
            className={styles.similarPhotosLoadMoreTile}
          >
            <span className={styles.similarPhotosLoadMoreTileBody}>
              <span className={styles.similarPhotosLoadMoreLabel}>Explore →</span>
              <span className={styles.similarPhotosLoadMoreHint}>
                Search similar in explore mode
              </span>
            </span>
          </a>
          {hasNextPage ? (
            <button
              type="button"
              className={styles.similarPhotosLoadMoreTile}
              disabled={isLoadingResults}
              onClick={() => {
                setOffset(results.length);
              }}
            >
              <span className={styles.similarPhotosLoadMoreTileBody}>
                <span className={styles.similarPhotosLoadMoreLabel}>
                  {isLoadingResults ? "Loading..." : "Load more"}
                </span>
                <span className={styles.similarPhotosLoadMoreHint}>
                  {isLoadingResults ? "Fetching similar photos" : `Show ${pageSize} more`}
                </span>
              </span>
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
};
