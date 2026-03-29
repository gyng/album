import React from "react";
import styles from "./Search.module.css";
import {
  SearchFacetSelection,
  serializeSearchFacetSelection,
} from "../../util/searchFacets";
import { SearchFilterPill } from "./SearchFilterPill";
import { SearchTag } from "./SearchTag";

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

type FilterCategoryId = "tags" | "place" | "gear" | "settings";

type FilterCategory = {
  id: FilterCategoryId;
  label: string;
};

const FILTER_CATEGORIES: FilterCategory[] = [
  { id: "tags", label: "Tags" },
  { id: "place", label: "Place" },
  { id: "gear", label: "Gear" },
  { id: "settings", label: "Settings" },
];

const CATEGORY_FACET_IDS: Record<Exclude<FilterCategoryId, "tags">, string[]> = {
  place: ["location", "region", "subregion", "city"],
  gear: ["camera", "lens"],
  settings: ["focal-length-35mm", "focal-length-actual", "aperture", "iso"],
};

type Props = {
  sections: SearchFacetSection[];
  selectedCategory: FilterCategoryId;
  selectedFacets: SearchFacetSelection[];
  normalizedSearchTerms: string[];
  normalizedTags: Tag[];
  refinementCounts: Record<string, number>;
  isLoading: boolean;
  onSelectCategory: (category: FilterCategoryId) => void;
  onToggleFacet: (selection: SearchFacetSelection) => void;
  onToggleTag: (tagName: string, isActive: boolean) => void;
};

export const SearchFacetPanel: React.FC<Props> = ({
  sections,
  selectedCategory,
  selectedFacets,
  normalizedSearchTerms,
  normalizedTags,
  refinementCounts,
  isLoading,
  onSelectCategory,
  onToggleFacet,
  onToggleTag,
}) => {
  const activeKeys = new Set(
    selectedFacets.map((selection) => serializeSearchFacetSelection(selection)),
  );

  const visibleSections =
    selectedCategory === "tags"
      ? []
      : sections.filter((section) =>
          CATEGORY_FACET_IDS[selectedCategory].includes(section.facetId),
        );
  const showSectionLabels = visibleSections.length > 1;

  return (
    <section
      id="search-filters-panel"
      className={styles.facetPanel}
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
              aria-selected={isActive}
              className={[
                styles.facetCategoryTab,
                isActive ? styles.facetCategoryTabActive : "",
              ].join(" ")}
              onClick={() => {
                onSelectCategory(category.id);
              }}
            >
              {category.label}
            </button>
          );
        })}
      </div>

      <div className={styles.facetCategoryContent}>
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

        {!isLoading && selectedCategory !== "tags"
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
