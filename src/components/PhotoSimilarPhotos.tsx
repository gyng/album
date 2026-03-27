import Link from "next/link";
import React from "react";
import styles from "./Photo.module.css";
import { useDatabase } from "./database/useDatabase";
import { fetchSimilarResults } from "./search/api";
import { SearchResultRow } from "./search/searchTypes";
import { getResizedAlbumImageSrc } from "../util/getResizedAlbumImageSrc";
import { extractDateFromExifString } from "../util/extractExifFromDb";
import { getRelativeTimeString } from "../util/time";

export const PhotoSimilarPhotos: React.FC<{
  path?: string | null;
  pageSize?: number;
}> = (props) => {
  const pageSize = props.pageSize ?? 9;
  const [database, progress] = useDatabase();
  const [results, setResults] = React.useState<SearchResultRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);
  const [hasNextPage, setHasNextPage] = React.useState(false);
  const [isLoadingResults, setIsLoadingResults] = React.useState(false);

  React.useEffect(() => {
    setResults([]);
    setError(null);
    setPage(0);
    setHasNextPage(false);
  }, [database, pageSize, props.path]);

  React.useEffect(() => {
    if (!database || !props.path) {
      return;
    }

    let isCancelled = false;
    setIsLoadingResults(true);
    setError(null);

    fetchSimilarResults({
      database,
      path: props.path,
      page,
      pageSize,
    })
      .then((response) => {
        if (isCancelled) {
          return;
        }

        setResults((prev) =>
          page === 0
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
  }, [database, page, pageSize, props.path]);

  if (!props.path) {
    return null;
  }

  return (
    <section className={styles.similarPhotos} aria-live="polite">
      <h3 className={styles.similarPhotosTitle}>Similar photos</h3>

      {!database ? (
        <p className={styles.similarPhotosStatus}>
          Loading search index
          {progress > 0 ? ` (${Math.round(progress)}%)` : ""}…
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
          {results.map((result) => {
            const albumName = result.path.split("/").at(-2);
            const dateTimeOriginal = extractDateFromExifString(result.exif);
            const relativeAge = dateTimeOriginal
              ? getRelativeTimeString(dateTimeOriginal, {
                  short: true,
                })
              : null;
            const similarityLabel =
              typeof result.similarity === "number"
                ? `${Math.round(result.similarity * 100)}% match`
                : null;

            return (
              <Link
                key={result.path}
                href={result.album_relative_path}
                className={styles.similarPhotoCard}
                title={
                  result.alt_text ||
                  result.subject ||
                  result.tags ||
                  result.filename
                }
              >
                {similarityLabel ? (
                  <span className={styles.similarPhotoBadge}>
                    {similarityLabel}
                  </span>
                ) : null}
                <img
                  src={getResizedAlbumImageSrc(result.path)}
                  alt={
                    result.alt_text ||
                    result.subject ||
                    result.tags ||
                    result.filename
                  }
                  className={styles.similarPhotoImage}
                  loading="lazy"
                />
                <span className={styles.similarPhotoMeta}>
                  <span className={styles.similarPhotoSource}>
                    <span className={styles.similarPhotoSourceText}>
                      {albumName}
                    </span>
                    <span className={styles.similarPhotoSourceText}>
                      {typeof relativeAge === "string"
                        ? ", " + relativeAge.replace(" ago", "")
                        : null}
                    </span>
                  </span>
                  <span className={styles.similarPhotoFilename}>
                    {result.filename}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {database && results.length > 0 && hasNextPage ? (
        <div className={styles.similarPhotosActions}>
          <button
            type="button"
            className={styles.similarPhotosLoadMore}
            disabled={isLoadingResults}
            onClick={() => {
              setPage((prev) => prev + 1);
            }}
          >
            {isLoadingResults ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </section>
  );
};
