import React from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import styles from "./Search.module.css";
import {
  SearchFacetSelection,
  serializeSearchFacetSelection,
} from "../../util/searchFacets";
import { SearchFilterPill } from "./SearchFilterPill";
import { SearchTag } from "./SearchTag";
import { hexToRgb, rgbToHex, RGB } from "../../util/colorDistance";

export type SearchFacetOption = {
  value: string;
  count: number;
};

export type SearchFacetSection = {
  facetId: string;
  displayName: string;
  options: SearchFacetOption[];
};

type Tag = {
  name: string;
  count: number;
};

type FilterCategoryId =
  | "tags"
  | "color"
  | "time"
  | "place"
  | "gear"
  | "settings";

type FilterCategory = {
  id: FilterCategoryId;
  label: string;
};

const FILTER_CATEGORIES: FilterCategory[] = [
  { id: "tags", label: "Tags" },
  { id: "color", label: "Colour" },
  { id: "time", label: "Time" },
  { id: "place", label: "Place" },
  { id: "gear", label: "Gear" },
  { id: "settings", label: "Settings" },
];

const CATEGORY_FACET_IDS: Record<
  Exclude<FilterCategoryId, "tags" | "color">,
  string[]
> = {
  time: ["year", "hour"],
  place: ["location", "region", "subregion", "city"],
  gear: ["camera", "lens"],
  settings: ["focal-length-35mm", "focal-length-actual", "aperture", "iso"],
};

type Props = {
  sections: SearchFacetSection[];
  selectedCategory: FilterCategoryId;
  colorSearch: RGB | null;
  colorTolerance: number;
  selectedFacets: SearchFacetSelection[];
  normalizedSearchTerms: string[];
  normalizedTags: Tag[];
  refinementCounts: Record<string, number>;
  isLoading: boolean;
  onSelectCategory: (category: FilterCategoryId) => void;
  onClearColorSearch: () => void;
  onSetColorSearch: (rgb: RGB) => void;
  onSetColorTolerance: (value: number) => void;
  onToggleFacet: (selection: SearchFacetSelection) => void;
  onToggleTag: (tagName: string, isActive: boolean) => void;
};

export const SearchFacetPanel: React.FC<Props> = ({
  sections,
  selectedCategory,
  colorSearch,
  colorTolerance,
  selectedFacets,
  normalizedSearchTerms,
  normalizedTags,
  refinementCounts,
  isLoading,
  onSelectCategory,
  onClearColorSearch,
  onSetColorSearch,
  onSetColorTolerance,
  onToggleFacet,
  onToggleTag,
}) => {
  const activeKeys = new Set(
    selectedFacets.map((selection) => serializeSearchFacetSelection(selection)),
  );

  const categoryTabRefs = React.useRef<
    Record<FilterCategoryId, HTMLButtonElement | null>
  >({} as Record<FilterCategoryId, HTMLButtonElement | null>);

  const handleCategoryKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    const isForward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const isBackward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!isForward && !isBackward) {
      return;
    }

    event.preventDefault();
    const currentIndex = FILTER_CATEGORIES.findIndex(
      (category) => category.id === selectedCategory,
    );
    const delta = isForward ? 1 : -1;
    const nextIndex =
      (currentIndex + delta + FILTER_CATEGORIES.length) %
      FILTER_CATEGORIES.length;
    const nextCategory = FILTER_CATEGORIES[nextIndex];
    if (!nextCategory) {
      return;
    }

    onSelectCategory(nextCategory.id);
    categoryTabRefs.current[nextCategory.id]?.focus();
  };

  const visibleSections =
    selectedCategory === "tags" || selectedCategory === "color"
      ? []
      : sections.filter((section) =>
          CATEGORY_FACET_IDS[selectedCategory].includes(section.facetId),
        );
  const showSectionLabels = visibleSections.length > 1;

  // A single bottom fade on the scroll container (not per section) that only
  // shows while there's more to scroll, as an affordance for the long pill
  // lists. The whole panel scrolls as one, so the fade lives here.
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [hasScrollAbove, setHasScrollAbove] = React.useState(false);
  const [hasScrollBelow, setHasScrollBelow] = React.useState(false);

  const updateScrollFade = React.useCallback(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    setHasScrollAbove(el.scrollTop > 4);
    setHasScrollBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);

  // Recompute when the visible content changes (category switch, filters
  // loading in, facet counts updating).
  React.useEffect(() => {
    updateScrollFade();
  }, [updateScrollFade, selectedCategory, isLoading, sections, normalizedTags]);

  // …and when the panel resizes (its height is viewport-relative).
  React.useEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(updateScrollFade);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollFade]);
  const pickerHex = colorSearch ? rgbToHex(colorSearch) : "#ff6b6b";
  const handleHexChange = (value: string) => {
    const rgb = hexToRgb(value);
    if (rgb) {
      onSetColorSearch(rgb);
    }
  };

  return (
    <section
      id="search-filters-panel"
      className={[
        styles.facetPanel,
        selectedCategory === "color" ? styles.facetPanelColorMode : "",
      ].filter(Boolean).join(" ")}
      aria-label="Search filters"
    >
      <div className={styles.facetCategoryRail} role="tablist" aria-label="Filter categories">
        {FILTER_CATEGORIES.map((category) => {
          const isActive = category.id === selectedCategory;
          return (
            <button
              key={category.id}
              type="button"
              role="tab"
              id={`search-filter-tab-${category.id}`}
              aria-selected={isActive}
              aria-controls="search-filters-content"
              tabIndex={isActive ? 0 : -1}
              ref={(element) => {
                categoryTabRefs.current[category.id] = element;
              }}
              className={[
                styles.facetCategoryTab,
                isActive ? styles.facetCategoryTabActive : "",
              ].join(" ")}
              onClick={() => {
                onSelectCategory(category.id);
              }}
              onKeyDown={handleCategoryKeyDown}
            >
              {category.label}
            </button>
          );
        })}
      </div>

      <div
        id="search-filters-content"
        role="tabpanel"
        aria-labelledby={`search-filter-tab-${selectedCategory}`}
        ref={contentRef}
        onScroll={updateScrollFade}
        className={[
          styles.facetCategoryContent,
          hasScrollAbove || hasScrollBelow
            ? styles.facetCategoryContentFade
            : "",
          hasScrollAbove ? styles.facetFadeAbove : "",
          hasScrollBelow ? styles.facetFadeBelow : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {isLoading ? (
          <div className={styles.searchModeStatus}>Loading filters…</div>
        ) : null}

        {!isLoading && selectedCategory === "tags" ? (
          <div className={styles.facetSection}>
            <div className={styles.tagsContainer}>
              {normalizedTags.map((tag) => {
                const isActive = normalizedSearchTerms.includes(tag.name);
                const refinementCount = refinementCounts[tag.name];
                const isDisabled = !isActive && refinementCount === 0;
                const visibleCount =
                  !isActive && refinementCount !== undefined
                    ? refinementCount
                    : tag.count - 1;

                return (
                  <SearchTag
                    key={tag.name}
                    tag={tag.name}
                    count={visibleCount}
                    isActive={isActive}
                    disabled={isDisabled}
                    onClick={() => {
                      onToggleTag(tag.name, isActive);
                    }}
                  />
                );
              })}
            </div>
          </div>
        ) : null}

        {selectedCategory === "color" ? (
          <div className={`${styles.facetSection} ${styles.colorFacetSection}`}>
            <div className={styles.colorFacetControl}>
              <HexColorPicker
                color={pickerHex}
                onChange={handleHexChange}
                className={styles.colorFacetPicker}
              />
              <div className={styles.colorFacetMeta}>
                <div className={styles.colorFacetHeader}>
                  <div className={styles.colorFacetCurrent}>
                    <label
                      className={styles.colorFacetCurrentSwatchButton}
                      title="Open native colour picker"
                    >
                      <span
                        className={styles.colorFacetCurrentSwatch}
                        style={{ backgroundColor: pickerHex }}
                        aria-hidden="true"
                      />
                      <input
                        type="color"
                        className={styles.colorFacetNativeInput}
                        value={pickerHex}
                        onChange={(event) => {
                          handleHexChange(event.target.value);
                        }}
                        aria-label="Current colour swatch"
                      />
                    </label>
                    <span className={styles.colorFacetCurrentHex}>
                      {pickerHex}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.colorFacetClearButton}
                    onClick={onClearColorSearch}
                    disabled={!colorSearch}
                  >
                    Clear
                  </button>
                </div>
                <label className={styles.colorFacetHexLabel}>
                  <span className={styles.facetSectionTitle}>Hex</span>
                  <HexColorInput
                    aria-label="Colour filter hex value"
                    color={pickerHex}
                    onChange={handleHexChange}
                    prefixed
                    className={styles.colorFacetHexInput}
                  />
                </label>
                <div className={styles.colorFacetRangeGroup}>
                  <span className={styles.facetSectionTitle}>Range</span>
                  <label className={styles.colorFacetRangeLabel}>
                    <input
                      type="range"
                      className={styles.colorFacetToleranceSlider}
                      min={5}
                      max={60}
                      value={colorTolerance}
                      onChange={(event) =>
                        onSetColorTolerance(Number(event.target.value))
                      }
                      aria-label="Colour distance tolerance"
                    />
                    <span className={styles.colorFacetToleranceValue}>
                      ±{colorTolerance}
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {!isLoading && selectedCategory !== "tags" && selectedCategory !== "color"
          ? visibleSections.map((section) => (
              <div key={section.facetId} className={styles.facetSection}>
                {showSectionLabels ? (
                  <h2 className={styles.facetSectionTitle}>
                    {section.displayName}
                  </h2>
                ) : null}
                <div className={styles.tagsContainer}>
                  {section.options.map((option) => {
                    const selection = {
                      facetId: section.facetId,
                      value: option.value,
                    };
                    const key = serializeSearchFacetSelection(selection);
                    const isActive = activeKeys.has(key);
                    const isPlaceFacet =
                      selection.facetId === "location" ||
                      selection.facetId === "region" ||
                      selection.facetId === "subregion" ||
                      selection.facetId === "city";
                    const isDisabled =
                      !isPlaceFacet && !isActive && option.count === 0;

                    return (
                      <SearchFilterPill
                        key={key}
                        label={option.value}
                        count={option.count}
                        isActive={isActive}
                        disabled={isDisabled}
                        onClick={() => {
                          onToggleFacet(selection);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))
          : null}
      </div>
    </section>
  );
};
