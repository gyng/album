import React from "react";
import styles from "./Photo.module.css";
import { useDatabase, useEmbeddingsDatabase } from "./database/useDatabase";
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
  const [database, progress, , databaseError] = useDatabase();
  const [embeddingsDatabase, embeddingsProgress] = useEmbeddingsDatabase(Boolean(props.path));
  const [results, setResults] = React.useState<SearchResultRow[]>([]);
  const [offset, setOffset] = React.useState(0);
  const [hasNextPage, setHasNextPage] = React.useState(false);

  // A new photograph, database or page size starts the list again — during
  // render, so no request ever goes out with the previous photograph's offset.
  const [listFor, setListFor] = React.useState({ database, initialVisibleCount, path: props.path });
  if (
    listFor.database !== database ||
    listFor.initialVisibleCount !== initialVisibleCount ||
    listFor.path !== props.path
  ) {
    setListFor({ database, initialVisibleCount, path: props.path });
    setResults([]);
    setOffset(0);
    setHasNextPage(false);
  }

  // Loading and failure belong to a request: the one on screen is loading until
  // a request with exactly these inputs has finished.
  const request = {
    database,
    embeddingsDatabase,
    initialVisibleCount,
    offset,
    pageSize,
    path: props.path,
  };
  type Request = typeof request;
  const [settled, setSettled] = React.useState<{ request: Request; error: string | null } | null>(
    null,
  );
  const isCurrent = (other: Request) =>
    (Object.keys(request) as Array<keyof Request>).every((key) => other[key] === request[key]);
  const current = settled && isCurrent(settled.request) ? settled : null;
  const isLoadingResults = Boolean(database && embeddingsDatabase && props.path) && !current;
  const error = current?.error ?? null;

  React.useEffect(() => {
    if (!database || !embeddingsDatabase || !props.path) {
      return;
    }

    let isCancelled = false;
    const started = {
      database,
      embeddingsDatabase,
      initialVisibleCount,
      offset,
      pageSize,
      path: props.path,
    };

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
        setSettled({ request: started, error: null });
      })
      .catch((err: unknown) => {
        if (isCancelled) {
          return;
        }

        console.error("Failed to load similar photos", err);
        setSettled({ request: started, error: "Could not load similar photos." });
      });

    return () => {
      isCancelled = true;
    };
  }, [database, embeddingsDatabase, initialVisibleCount, offset, pageSize, props.path]);

  if (!props.path) {
    return null;
  }

  return (
    <section className={styles.similarPhotos} aria-live="polite">
      <Heading level={2} as="h3" className={styles.similarPhotosTitle}>
        Similar photos
      </Heading>

      {/* This section appears on every photo detail view, so a missing index
          used to leave "Loading search index…" on screen permanently. */}
      {databaseError ? (
        <p className={styles.similarPhotosStatus}>
          Similar photos need a search index, which has not been built yet.
        </p>
      ) : !database ? (
        <p className={styles.similarPhotosStatus}>
          Loading search index
          {progress > 0 ? ` (${Math.round(progress)}%)` : ""}…
        </p>
      ) : !embeddingsDatabase ? (
        <p className={styles.similarPhotosStatus}>
          Loading similarity index
          {embeddingsProgress > 0 ? ` (${Math.round(embeddingsProgress)}%)` : ""}…
        </p>
      ) : isLoadingResults && results.length === 0 ? (
        <p className={styles.similarPhotosStatus}>Finding similar photos…</p>
      ) : error ? (
        <p className={styles.similarPhotosStatus}>{error}</p>
      ) : results.length === 0 ? (
        <p className={styles.similarPhotosStatus}>No similar photos indexed for this image yet.</p>
      ) : (
        <div className={styles.similarPhotoGrid}>
          {results.map((result) => (
            <SearchResultTile key={result.path} result={result} />
          ))}
          <a
            href={`/search?similar=${encodeURIComponent(props.path)}`}
            className={styles.similarPhotosLoadMoreTile}
            aria-label="Explore similar photos in search"
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
              aria-label="Load more similar photos"
              onClick={() => {
                setOffset(results.length);
              }}
            >
              <span className={styles.similarPhotosLoadMoreTileBody}>
                <span className={styles.similarPhotosLoadMoreLabel}>
                  {isLoadingResults ? "Loading…" : "Load more"}
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
