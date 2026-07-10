import type { SearchFacetSelection } from "../../util/searchFacets";
import type { SearchFacetSection } from "./SearchFacetPanel";

export const normaliseSearchTerms = (terms: string[]): string[] =>
  terms.map((term) => term.trim().toLowerCase()).filter(Boolean);

export const getActiveFilterCount = ({
  selectedFacetCount,
  searchTermCount,
  hasColour,
  hasImage,
}: {
  selectedFacetCount: number;
  searchTermCount: number;
  hasColour: boolean;
  hasImage: boolean;
}): number => selectedFacetCount + searchTermCount + (hasColour ? 1 : 0) + (hasImage ? 1 : 0);

export const mergeFacetSections = (
  catalogSections: SearchFacetSection[],
  liveSections: SearchFacetSection[],
  selectedFacets: SearchFacetSelection[],
): SearchFacetSection[] => {
  const liveSectionMap = new Map(liveSections.map((section) => [section.facetId, section]));
  const selectedValuesByFacet = new Map<string, Set<string>>();
  selectedFacets.forEach((selection) => {
    const values = selectedValuesByFacet.get(selection.facetId) ?? new Set<string>();
    values.add(selection.value);
    selectedValuesByFacet.set(selection.facetId, values);
  });

  const mergeSection = (section: SearchFacetSection): SearchFacetSection => {
    const liveSection = liveSectionMap.get(section.facetId);
    const liveOptionMap = new Map(
      (liveSection?.options ?? []).map((option) => [option.value, option.count]),
    );
    const orderedOptions = [...section.options];

    (liveSection?.options ?? []).forEach((option) => {
      if (!orderedOptions.some((candidate) => candidate.value === option.value)) {
        orderedOptions.push(option);
      }
    });

    Array.from(selectedValuesByFacet.get(section.facetId) ?? []).forEach((value) => {
      if (!orderedOptions.some((candidate) => candidate.value === value)) {
        orderedOptions.push({ value, count: 0 });
      }
    });

    return {
      ...section,
      options: orderedOptions.map((option) => ({
        value: option.value,
        count: liveOptionMap.get(option.value) ?? 0,
      })),
    };
  };

  const merged = catalogSections.map(mergeSection);

  liveSections.forEach((section) => {
    if (!catalogSections.some((candidate) => candidate.facetId === section.facetId)) {
      merged.push(
        mergeSection({
          facetId: section.facetId,
          displayName: section.displayName,
          options: section.options,
        }),
      );
    }
  });

  return merged;
};
