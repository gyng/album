import React, { useSyncExternalStore } from "react";
import { Input, Select } from "../ui";
import styles from "./Search.module.css";
import { SearchMode } from "./useTextVector";

type Props = {
  canClear: boolean;
  databaseReady: boolean;
  disabled?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isFetching: boolean;
  isSimilarMode: boolean;
  isSuccess: boolean;
  queryResultsLength?: number;
  searchInputValue: string;
  searchMode: SearchMode;
  trimmedQuery: string;
  onApplySearchTerms: (terms: string[]) => void;
  onClearSearchState: () => void;
  onStartRandomSimilarSearch: () => void;
  onSetSearchMode: (mode: SearchMode) => void;
};

export const SearchInputBar: React.FC<Props> = ({
  canClear,
  databaseReady,
  disabled,
  inputRef,
  isFetching,
  isSimilarMode,
  isSuccess,
  queryResultsLength,
  searchInputValue,
  searchMode,
  trimmedQuery,
  onApplySearchTerms,
  onClearSearchState,
  onStartRandomSimilarSearch,
  onSetSearchMode,
}) => {
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  return (
    <div className={styles.searchInputRow}>
      {isSimilarMode ? null : (
        <>
          <div className={styles.searchInputContainer}>
            <Input
              className={styles.searchInput}
              suppressHydrationWarning
              type="text"
              value={searchInputValue}
              placeholder="Type / to search (try 'cat at night', 'white', 'mavica')"
              spellCheck={false}
              autoFocus
              onChange={(ev) => {
                onApplySearchTerms(ev.target.value.split(","));
              }}
              ref={inputRef}
              tabIndex={0}
              title={
                disabled || !databaseReady
                  ? "Disabled: the SQLite WASM failed to load, your browser does not support service workers, or the server is missing the proper COEP/COOP headers"
                  : undefined
              }
            />
            {canClear ? (
              <button
                className={styles.clearButton}
                onClick={onClearSearchState}
                title="Clear search"
                type="button"
              >
                ×
              </button>
            ) : null}
          </div>
          <label className={styles.searchModeSelectLabel}>
            <Select
              className={styles.searchModeSelect}
              aria-label="Search mode"
              value={searchMode}
              onChange={(event) => {
                onSetSearchMode(event.target.value as SearchMode);
              }}
            >
              <option value="keyword">Keyword search</option>
              <option value="semantic">Semantic search</option>
              <option value="hybrid">Semantic + keyword</option>
            </Select>
            <span
              className={styles.searchModeInfo}
              aria-label="Search mode help"
              title="Keyword search matches indexed terms. Semantic search matches visual meaning using embeddings. Hybrid search fuses both rankings."
            >
              ⓘ
            </span>
          </label>
          {isMounted ? (
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={onStartRandomSimilarSearch}
              disabled={!databaseReady}
              title="Start with a random photo"
            >
              🎲 Random starting photo
            </button>
          ) : null}
        </>
      )}

      {isSuccess &&
      !isFetching &&
      !isSimilarMode &&
      searchMode === "keyword" &&
      trimmedQuery.length < 3 &&
      queryResultsLength === 0 ? (
        <div className={styles.searchHintInline}>
          Type a minimum of 3 characters
        </div>
      ) : null}
    </div>
  );
};
