import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import React, { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { Input, Select, TooltipSurface } from "../ui";
import sharedStyles from "./Search.module.css";
import localStyles from "./SearchInputBar.module.css";
import { SearchMode } from "./useTextVector";

const styles = mergeCssModuleStyles(sharedStyles, localStyles, [
  "clearButton",
  "imageQueryActions",
  "imageQueryFileInput",
  "searchHintInline",
  "searchActivity",
  "searchInput",
  "searchInputBusy",
  "searchInputContainer",
  "searchInputRow",
  "searchModeInfo",
  "searchModeInfoTooltip",
  "searchModeInfoWrap",
  "searchModeSelect",
  "searchModeSelectLabel",
  "secondaryAction",
]);

const SEARCH_MODE_HELP =
  "Keyword finds matching words. Semantic finds photos with a similar meaning. Hybrid combines both.";

type Props = {
  canClear: boolean;
  databaseReady: boolean;
  disabled?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isSearching: boolean;
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
  onPickImageQuery: (file: File) => void;
  onOpenDrawPad: () => void;
};

export const SearchInputBar: React.FC<Props> = ({
  canClear,
  databaseReady,
  disabled,
  inputRef,
  isSearching,
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
  onPickImageQuery,
  onOpenDrawPad,
}) => {
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const modeHelpId = useId();
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);

  // Focus the search box on mount so typing starts a query immediately. This
  // replaces the `autoFocus` attribute, which jsx-a11y/no-autofocus flags as a
  // usability hazard; a mount-time focus() is the accepted alternative.
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  return (
    <div className={styles.searchInputRow}>
      {isSimilarMode ? null : (
        <>
          <div className={styles.searchInputContainer}>
            <Input
              className={[styles.searchInput, isSearching ? styles.searchInputBusy : ""]
                .filter(Boolean)
                .join(" ")}
              type="text"
              aria-label="Search photos"
              aria-busy={isSearching}
              value={searchInputValue}
              placeholder="Search for cats at night, white, or Mavica…"
              spellCheck={false}
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
            {isSearching ? (
              <span className={styles.searchActivity} role="img" aria-label="Searching" />
            ) : null}
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
                popoverTarget={modeHelpId}
              >
                <span aria-hidden="true">ⓘ</span>
              </button>
              <TooltipSurface
                id={modeHelpId}
                role="tooltip"
                popover="auto"
                className={styles.searchModeInfoTooltip}
              >
                {SEARCH_MODE_HELP}
              </TooltipSurface>
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
          <div className={styles.imageQueryActions}>
            <input
              ref={imageFileInputRef}
              className={styles.imageQueryFileInput}
              type="file"
              accept="image/*"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onPickImageQuery(file);
                }
                // Reset so re-picking the same file fires change again.
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => imageFileInputRef.current?.click()}
              disabled={!databaseReady}
              title="Upload a photo and find visually similar ones"
            >
              📷 Search by image
            </button>
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={onOpenDrawPad}
              disabled={!databaseReady}
              title="Draw a sketch and find photos that look like it"
            >
              ✏️ Draw to search
            </button>
          </div>
        </>
      )}

      {isSuccess &&
      !isSearching &&
      !isSimilarMode &&
      searchMode === "keyword" &&
      trimmedQuery.length < 3 &&
      queryResultsLength === 0 ? (
        <div className={styles.searchHintInline}>Enter at least 3 characters</div>
      ) : null}
    </div>
  );
};
