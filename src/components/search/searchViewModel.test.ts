import type { SearchFacetSelection } from "../../util/searchFacets";
import type { SearchFacetSection } from "./SearchFacetPanel";
import { getActiveFilterCount, mergeFacetSections, normaliseSearchTerms } from "./searchViewModel";

describe("searchViewModel", () => {
  it("normalises terms and counts each active filter domain", () => {
    expect(normaliseSearchTerms([" Cat ", "", "NIGHT"])).toEqual(["cat", "night"]);
    expect(
      getActiveFilterCount({
        selectedFacetCount: 2,
        searchTermCount: 2,
        hasColour: true,
        hasImage: true,
      }),
    ).toBe(6);
    expect(
      getActiveFilterCount({
        selectedFacetCount: 0,
        searchTermCount: 0,
        hasColour: false,
        hasImage: false,
      }),
    ).toBe(0);
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
      { facetId: "city", value: "Tokyo" },
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

  it("adds live-only sections and preserves selected values when live data is absent", () => {
    const catalog: SearchFacetSection[] = [
      {
        facetId: "city",
        displayName: "City",
        options: [{ value: "Tokyo", count: 10 }],
      },
    ];
    const live: SearchFacetSection[] = [
      {
        facetId: "camera",
        displayName: "Camera",
        options: [{ value: "X-T5", count: 3 }],
      },
    ];

    expect(mergeFacetSections(catalog, live, [{ facetId: "city", value: "Kyoto" }])).toEqual([
      {
        facetId: "city",
        displayName: "City",
        options: [
          { value: "Tokyo", count: 0 },
          { value: "Kyoto", count: 0 },
        ],
      },
      {
        facetId: "camera",
        displayName: "Camera",
        options: [{ value: "X-T5", count: 3 }],
      },
    ]);
  });
});
