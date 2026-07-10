import type { SearchFacetSelection } from "../../util/searchFacets";
import type { SearchFacetSection } from "./SearchFacetPanel";
import {
  getActiveFilterCount,
  mergeFacetSections,
  normaliseSearchTerms,
} from "./searchViewModel";

describe("searchViewModel", () => {
  it("normalises terms and counts each active filter domain", () => {
    expect(normaliseSearchTerms([" Cat ", "", "NIGHT"])).toEqual([
      "cat",
      "night",
    ]);
    expect(
      getActiveFilterCount({
        selectedFacetCount: 2,
        searchTermCount: 2,
        hasColour: true,
        hasImage: true,
      }),
    ).toBe(6);
  });

  it("keeps catalog order while applying live and selected facet counts", () => {
    const catalog: SearchFacetSection[] = [
      {
        facetId: "city",
        displayName: "City",
        options: [
          { value: "Tokyo", count: 10 },
          { value: "Kyoto", count: 4 },
        ],
      },
    ];
    const live: SearchFacetSection[] = [
      {
        facetId: "city",
        displayName: "City",
        options: [
          { value: "Tokyo", count: 2 },
          { value: "Osaka", count: 1 },
        ],
      },
    ];
    const selected: SearchFacetSelection[] = [
      { facetId: "city", value: "Nagoya" },
    ];

    expect(mergeFacetSections(catalog, live, selected)).toEqual([
      {
        facetId: "city",
        displayName: "City",
        options: [
          { value: "Tokyo", count: 2 },
          { value: "Kyoto", count: 0 },
          { value: "Osaka", count: 1 },
          { value: "Nagoya", count: 0 },
        ],
      },
    ]);
  });
});
