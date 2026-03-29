import React, { useEffect, useState } from "react";
import styles from "./Search.module.css";
import { hexToRgb, RGB, rgbToString } from "../../util/colorDistance";
import { SearchMode } from "./useTextVector";

type Props = {
  canClear: boolean;
  colorHex: string | null;
  colorSearch: RGB | null;
  colorTolerance: number;
  databaseReady: boolean;
  disabled?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isColorMode: boolean;
  isFetching: boolean;
  isSimilarMode: boolean;
  isSuccess: boolean;
  modeSourceRef: React.RefObject<HTMLDivElement | null>;
  queryResultsLength?: number;
  searchInputValue: string;
  searchMode: SearchMode;
  trimmedQuery: string;
  onApplySearchTerms: (terms: string[]) => void;
  onClearSearchState: () => void;
  onStartRandomSimilarSearch: () => void;
  onSetColorSearch: (rgb: RGB) => void;
  onSetColorTolerance: (value: number) => void;
  onSetSearchMode: (mode: SearchMode) => void;
};

export const SearchInputBar: React.FC<Props> = ({
  canClear,
  colorHex,
  colorSearch,
  colorTolerance,
  databaseReady,
  disabled,
  inputRef,
  isColorMode,
  isFetching,
  isSimilarMode,
  isSuccess,
  modeSourceRef,
  queryResultsLength,
  searchInputValue,
  searchMode,
  trimmedQuery,
  onApplySearchTerms,
  onClearSearchState,
  onStartRandomSimilarSearch,
  onSetColorSearch,
  onSetColorTolerance,
  onSetSearchMode,
}) => {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <div className={styles.searchInputRow}>
      {isColorMode && colorSearch ? (
        <div className={styles.modeInputArea} ref={modeSourceRef}>
          <label
            className={styles.modeColorSwatchLabel}
            title="Click to change color"
          >
            <div
              className={styles.modeColorSwatch}
              style={{ backgroundColor: rgbToString(colorSearch) }}
            />
            <input
              type="color"
              className={styles.modeColorInput}
              value={colorHex ?? ""}
              onChange={(e) => {
                const rgb = hexToRgb(e.target.value);
                if (rgb) onSetColorSearch(rgb);
              }}
            />
          </label>
          <span className={styles.modeColorHex}>{colorHex}</span>
          <div className={styles.modeColorDivider} />
          <label className={styles.modeColorToleranceLabel}>
            <span className={styles.modeLabel}>Range</span>
            <input
              type="range"
              className={styles.modeColorToleranceSlider}
              min={5}
              max={60}
              value={colorTolerance}
              onChange={(e) => onSetColorTolerance(Number(e.target.value))}
              aria-label="Color distance tolerance"
              title="How similar the color needs to be (lower = more exact, higher = more results)"
            />
            <span className={styles.modeColorToleranceValue}>
              ±{colorTolerance}
            </span>
          </label>
          <button
            type="button"
            className={styles.modeClearButton}
            onClick={onClearSearchState}
            aria-label="Exit color search"
            title="Exit color search"
          >
            ×
          </button>
        </div>
      ) : isSimilarMode ? null : (
        <>
          <div className={styles.searchInputContainer}>
            <input
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
            <select
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
            </select>
            <span
              className={styles.searchModeInfo}
              aria-label="Search mode help"
              title="Keyword search matches indexed terms. Semantic search matches visual meaning using embeddings. Hybrid search fuses both rankings."
            >
              ⓘ
            </span>
          </label>
          <label
            className={styles.secondaryAction}
            title="Pick a color to search by"
          >
            🎨 Color
            <input
              type="color"
              className={styles.colorPickerInput}
              onChange={(e) => {
                const rgb = hexToRgb(e.target.value);
                if (rgb) {
                  onClearSearchState();
                  onSetColorSearch(rgb);
                }
              }}
            />
          </label>
          {isMounted ? (
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={onStartRandomSimilarSearch}
              disabled={!databaseReady}
              title="Start similarity search for a random image"
            >
              🎲 Similarity search
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
