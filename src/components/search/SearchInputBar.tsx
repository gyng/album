import React, { useId, useState, useSyncExternalStore } from "react";
import { Input, Select } from "../ui";
import styles from "./Search.module.css";
import { SearchMode } from "./useTextVector";

const SEARCH_MODE_HELP =
  "Keyword search matches indexed terms. Semantic search matches visual meaning using embeddings. Hybrid search fuses both rankings.";

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
  const [isModeHelpOpen, setIsModeHelpOpen] = useState(false);
  const modeHelpId = useId();

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
                aria-label="Clear search"
                title="Clear search"
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </div>
          <div className={styles.searchModeSelectLabel}>
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
            <span className={styles.searchModeInfoWrap}>
              <button
                type="button"
                className={styles.searchModeInfo}
                aria-label="Search mode help"
                aria-expanded={isModeHelpOpen}
                aria-describedby={modeHelpId}
                title={SEARCH_MODE_HELP}
                onClick={() => setIsModeHelpOpen((open) => !open)}
                onBlur={() => setIsModeHelpOpen(false)}
              >
                <span aria-hidden="true">ⓘ</span>
              </button>
              <span
                id={modeHelpId}
                role="tooltip"
                className={[
                  styles.searchModeInfoTooltip,
                  isModeHelpOpen ? styles.searchModeInfoTooltipOpen : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {SEARCH_MODE_HELP}
              </span>
            </span>
          </div>
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
