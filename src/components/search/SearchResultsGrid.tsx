import React from "react";
import styles from "./Search.module.css";
import { SearchResultTile } from "./SearchResultTile";
import { SearchResultRow } from "./searchTypes";
import { RGB } from "../../util/colorDistance";

type Props = {
  isSimilarMode: boolean;
  isColorMode: boolean;
  /** An uploaded/drawn image query is active — it has no text/similar/colour
   *  state, so it must count as an active search in its own right. */
  isImageQueryMode: boolean;
  isColorCategoryActive: boolean;
  hasFacetFilters: boolean;
  searchInputValue: string;
  trimmedQuery: string;
  similarPath: string | null;
  results: SearchResultRow[] | undefined;
  isSuccess: boolean;
  isError: boolean;
  isFetching: boolean;
  /** Includes debounce, vector encoding, deferred database work, and fetches. */
  isSearching: boolean;
  isPlaceholderData: boolean;
  hasNextPage: boolean;
  similarClickstreamPaths: Set<string>;
  onFindSimilar: (path: string, similarity?: number) => void;
  onSearchByColor?: (color: RGB) => void;
  onFetchNextPage: () => void;
};

export const SearchResultsGrid: React.FC<Props> = ({
  isSimilarMode,
  isColorMode,
  isImageQueryMode,
  isColorCategoryActive,
  hasFacetFilters,
  searchInputValue,
  trimmedQuery,
  similarPath,
  results,
  isSuccess,
  isError,
  isFetching,
  isSearching,
  isPlaceholderData,
  hasNextPage,
  similarClickstreamPaths,
  onFindSimilar,
  onSearchByColor,
  onFetchNextPage,
}) => {
  const showResults =
    isSimilarMode ||
    isColorMode ||
    isImageQueryMode ||
    hasFacetFilters ||
    searchInputValue.trim().length > 0;
  const hasTextQuery = trimmedQuery.length >= 3;
  const isPureColorSearch = isColorMode && !hasTextQuery && !hasFacetFilters;

  if (!showResults) {
    return <ul className={styles.results} />;
  }

  return (
    <ul className={styles.results} aria-busy={isSearching}>
      <li
        className={isSearching ? styles.searchingStatus : undefined}
        role="status"
        aria-live="polite"
        aria-busy={isSearching}
      >
        {isSearching ? (
          <>
            <span className={styles.searchingPulse} aria-hidden="true" />
            Searching&hellip;
          </>
        ) : null}
      </li>

      {isError && !isSearching ? (
        <li className={styles.inlineError}>
          Something went wrong running this search. Try again or adjust your query.
        </li>
      ) : null}

      {isSuccess && !isSearching && results?.length === 0 && isSimilarMode ? (
        <li className={styles.sectionStatus}>
          No similar results for <i>{similarPath?.split("/").at(-1)}</i>
        </li>
      ) : null}

      {isSuccess && !isSearching && results?.length === 0 && isPureColorSearch ? (
        <li className={styles.sectionStatus}>No photos with a similar colour found.</li>
      ) : null}

      {isSuccess &&
      !isSearching &&
      results?.length === 0 &&
      !isSimilarMode &&
      (hasTextQuery || hasFacetFilters || isColorMode || isImageQueryMode) ? (
        <li className={styles.sectionStatus}>
          {hasTextQuery ? (
            <>
              No results for <i>{trimmedQuery}</i>
            </>
          ) : (
            <>No results for the selected filters.</>
          )}
        </li>
      ) : null}

      {results?.map((r) => {
        const isVisitedInSimilarTrail = isSimilarMode && similarClickstreamPaths.has(r.path);
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
              persistColorAction={isColorCategoryActive}
              onFindSimilar={(path, similarity) => {
                onFindSimilar(path, similarity);
              }}
              onSearchByColor={onSearchByColor}
            />
          </li>
        );
      })}

      {hasNextPage && isSuccess ? (
        <li>
          <button
            type="button"
            className={styles.moreButton}
            onClick={onFetchNextPage}
            disabled={isFetching}
          >
            {isFetching ? <>Loading&hellip;</> : <>More&hellip;</>}
          </button>
        </li>
      ) : null}
    </ul>
  );
};
