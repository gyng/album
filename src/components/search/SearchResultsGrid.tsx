import React from "react";
import styles from "./Search.module.css";
import { SearchResultTile } from "./SearchResultTile";
import { SearchResultRow } from "./searchTypes";

type Props = {
  isSimilarMode: boolean;
  isColorMode: boolean;
  searchInputValue: string;
  trimmedQuery: string;
  similarPath: string | null;
  results: SearchResultRow[] | undefined;
  isSuccess: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
  hasNextPage: boolean;
  similarClickstreamPaths: Set<string>;
  onFindSimilar: (path: string, similarity?: number) => void;
  onFetchNextPage: () => void;
};

export const SearchResultsGrid: React.FC<Props> = ({
  isSimilarMode,
  isColorMode,
  searchInputValue,
  trimmedQuery,
  similarPath,
  results,
  isSuccess,
  isFetching,
  isPlaceholderData,
  hasNextPage,
  similarClickstreamPaths,
  onFindSimilar,
  onFetchNextPage,
}) => {
  const showResults =
    isSimilarMode || isColorMode || searchInputValue.trim().length > 0;

  if (!showResults) {
    return <ul className={styles.results} />;
  }

  return (
    <ul className={styles.results}>
      {isSuccess && !isFetching && results?.length === 0 && isSimilarMode ? (
        <div>
          No similar results for <i>{similarPath?.split("/").at(-1)}</i>
        </div>
      ) : null}

      {isSuccess && !isFetching && results?.length === 0 && isColorMode ? (
        <div>No photos with a similar color found.</div>
      ) : null}

      {isSuccess &&
      !isFetching &&
      results?.length === 0 &&
      !isSimilarMode &&
      trimmedQuery.length >= 3 ? (
        <div>
          No results for <i>{trimmedQuery}</i>
        </div>
      ) : null}

      {results?.map((r) => {
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
                onFindSimilar(path, similarity);
              }}
            />
          </li>
        );
      })}

      {hasNextPage && isSuccess ? (
        <button
          className={styles.moreButton}
          onClick={onFetchNextPage}
          disabled={isFetching}
        >
          {isFetching ? <>Loading&hellip;</> : <>More&hellip;</>}
        </button>
      ) : null}

      {isFetching && !isSuccess ? <div>Searching&hellip;</div> : null}
    </ul>
  );
};
