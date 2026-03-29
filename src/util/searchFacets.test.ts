import {
  buildSearchFacetHref,
  buildSearchHref,
  getSearchFacetChipLabel,
  parseSearchFacetSelection,
  readSearchFacetSelections,
  writeSearchFacetSelections,
} from "./searchFacets";

describe("searchFacets", () => {
  it("parses repeated facet params from URLSearchParams", () => {
    const params = new URLSearchParams(
      "facet=camera:FUJIFILM%20X-T5&facet=location:Japan&facet=region:Tokyo&facet=subregion:Tokyo&facet=city:Shinjuku-ku",
    );

    expect(readSearchFacetSelections(params)).toEqual([
      { facetId: "camera", value: "FUJIFILM X-T5" },
      { facetId: "location", value: "Japan" },
      { facetId: "region", value: "Tokyo" },
      { facetId: "subregion", value: "Tokyo" },
      { facetId: "city", value: "Shinjuku-ku" },
    ]);
  });

  it("writes repeated facet params to URLSearchParams", () => {
    const params = new URLSearchParams();

    writeSearchFacetSelections(params, [
      { facetId: "camera", value: "FUJIFILM X-T5" },
      { facetId: "location", value: "Japan" },
    ]);

    expect(params.getAll("facet")).toEqual([
      "camera:FUJIFILM X-T5",
      "location:Japan",
    ]);
  });

  it("builds a deep link to search with one facet", () => {
    expect(
      buildSearchFacetHref({ facetId: "camera", value: "FUJIFILM X-T5" }),
    ).toBe("/search?facet=camera%3AFUJIFILM+X-T5");
  });

  it("builds a deep link to search with query and facets", () => {
    expect(
      buildSearchHref({
        query: ["temple"],
        facets: [{ facetId: "location", value: "Japan" }],
      }),
    ).toBe("/search?q=temple&facet=location%3AJapan");
  });

  it("rejects unsearchable facets", () => {
    expect(parseSearchFacetSelection("hour:17:00")).toBeNull();
  });

  it("formats active facet chip labels with short prefixes", () => {
    expect(
      getSearchFacetChipLabel({ facetId: "iso", value: "400" }),
    ).toBe("ISO: 400");
    expect(
      getSearchFacetChipLabel({
        facetId: "focal-length-35mm",
        value: "35–50mm",
      }),
    ).toBe("35mm eq.: 35–50mm");
    expect(
      getSearchFacetChipLabel({ facetId: "region", value: "Tokyo" }),
    ).toBe("Region: Tokyo");
    expect(
      getSearchFacetChipLabel({ facetId: "subregion", value: "Tokyo" }),
    ).toBe("Subregion: Tokyo");
    expect(
      getSearchFacetChipLabel({ facetId: "city", value: "Shinjuku-ku" }),
    ).toBe("City: Shinjuku-ku");
  });
});
