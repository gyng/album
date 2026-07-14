import {
  buildSimilaritySearchHref,
  buildSearchFacetHref,
  buildSearchHref,
  dedupeSearchFacetSelections,
  getBucketFacetSelection,
  getCameraFacetSelection,
  getLensFacetSelection,
  getLocationFacetSelection,
  getSearchFacetChipLabel,
  isSearchableFacetId,
  normalizeSearchFacetSelection,
  parseSearchFacetSelection,
  readSearchFacetSelections,
  serializeSearchFacetSelection,
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

  it("normalises valid values and rejects missing or unknown facets", () => {
    expect(normalizeSearchFacetSelection({ facetId: " camera ", value: " X-T5 " })).toEqual({
      facetId: "camera",
      value: "X-T5",
    });
    expect(normalizeSearchFacetSelection({ facetId: "", value: "X-T5" })).toBeNull();
    expect(normalizeSearchFacetSelection({ facetId: "camera", value: " " })).toBeNull();
    expect(normalizeSearchFacetSelection({ facetId: "unknown", value: "value" })).toBeNull();
    expect(isSearchableFacetId("camera")).toBe(true);
    expect(isSearchableFacetId("unknown")).toBe(false);
  });

  it("serialises and parses values containing additional colons", () => {
    const selection = { facetId: "camera", value: "Camera: Mark II" };
    expect(serializeSearchFacetSelection(selection)).toBe("camera:Camera: Mark II");
    expect(parseSearchFacetSelection("camera:Camera: Mark II")).toEqual(selection);
    expect(parseSearchFacetSelection("camera")).toBeNull();
    expect(parseSearchFacetSelection(":value")).toBeNull();
    expect(parseSearchFacetSelection("camera:")).toBeNull();
  });

  it("drops invalid and duplicate selections without changing first-seen order", () => {
    expect(
      dedupeSearchFacetSelections([
        { facetId: " camera ", value: "X-T5" },
        { facetId: "camera", value: "X-T5" },
        { facetId: "unknown", value: "x" },
        { facetId: "lens", value: "23mm" },
      ]),
    ).toEqual([
      { facetId: " camera ", value: "X-T5" },
      { facetId: "lens", value: "23mm" },
    ]);
  });

  it("ignores malformed repeated URL parameters", () => {
    expect(
      readSearchFacetSelections(
        new URLSearchParams("facet=invalid&facet=camera%3AX-T5&facet=camera%3AX-T5"),
      ),
    ).toEqual([{ facetId: "camera", value: "X-T5" }]);
  });

  it("writes repeated facet params to URLSearchParams", () => {
    const params = new URLSearchParams("facet=old:value&q=temple");

    writeSearchFacetSelections(params, [
      { facetId: "camera", value: "FUJIFILM X-T5" },
      { facetId: "location", value: "Japan" },
    ]);

    expect(params.getAll("facet")).toEqual(["camera:FUJIFILM X-T5", "location:Japan"]);
    expect(params.get("q")).toBe("temple");
  });

  it("builds a deep link to search with one facet", () => {
    expect(buildSearchFacetHref({ facetId: "camera", value: "FUJIFILM X-T5" })).toBe(
      "/search?facet=camera%3AFUJIFILM+X-T5",
    );
  });

  it("builds a deep link to search with query and facets", () => {
    expect(
      buildSearchHref({
        query: ["temple"],
        facets: [{ facetId: "location", value: "Japan" }],
      }),
    ).toBe("/search?q=temple&facet=location%3AJapan");
  });

  it("trims query values and omits empty search state", () => {
    expect(buildSearchHref()).toBe("/search");
    expect(buildSearchHref({ query: [" ", " temple "] })).toBe("/search?q=temple");
    expect(buildSearchHref({ facets: [] })).toBe("/search");
  });

  it("builds an encoded similarity-search link", () => {
    expect(buildSimilaritySearchHref("../albums/a/photo one.jpg")).toBe(
      "/search?similar=..%2Falbums%2Fa%2Fphoto+one.jpg",
    );
  });

  it("rejects unsearchable facets", () => {
    expect(parseSearchFacetSelection("shutter:1/250")).toBeNull();
    expect(buildSearchFacetHref({ facetId: "shutter", value: "1/250" })).toBeNull();
  });

  it("formats active facet chip labels with short prefixes", () => {
    expect(getSearchFacetChipLabel({ facetId: "hour", value: "17:00" })).toBe("Time: 17:00");
    expect(getSearchFacetChipLabel({ facetId: "year", value: "2024" })).toBe("Year: 2024");
    expect(getSearchFacetChipLabel({ facetId: "iso", value: "400" })).toBe("ISO: 400");
    expect(getSearchFacetChipLabel({ facetId: "aperture", value: "around f/2" })).toBe(
      "Aperture: around f/2",
    );
    expect(
      getSearchFacetChipLabel({
        facetId: "focal-length-35mm",
        value: "35–49mm · normal",
      }),
    ).toBe("35mm eq.: 35–49mm · normal");
    expect(
      getSearchFacetChipLabel({
        facetId: "focal-length-actual",
        value: "23–34mm · normal",
      }),
    ).toBe("Focal length: 23–34mm · normal");
    expect(getSearchFacetChipLabel({ facetId: "camera", value: "X-T5" })).toBe("Camera: X-T5");
    expect(getSearchFacetChipLabel({ facetId: "lens", value: "23mm" })).toBe("Lens: 23mm");
    expect(getSearchFacetChipLabel({ facetId: "location", value: "Japan" })).toBe("Country: Japan");
    expect(getSearchFacetChipLabel({ facetId: "region", value: "Tokyo" })).toBe("Region: Tokyo");
    expect(getSearchFacetChipLabel({ facetId: "subregion", value: "Tokyo" })).toBe(
      "Subregion: Tokyo",
    );
    expect(getSearchFacetChipLabel({ facetId: "city", value: "Shinjuku-ku" })).toBe(
      "City: Shinjuku-ku",
    );
    expect(getSearchFacetChipLabel({ facetId: "unknown", value: "Raw value" })).toBe("Raw value");
  });

  it("maps numeric values to searchable bucket selections", () => {
    expect(getBucketFacetSelection("iso", 400)).toEqual({ facetId: "iso", value: "400" });
    expect(getBucketFacetSelection("iso", null)).toBeNull();
    expect(getBucketFacetSelection("iso", Number.NaN)).toBeNull();
    expect(getBucketFacetSelection("camera", 1)).toBeNull();
    expect(getBucketFacetSelection("unknown", 1)).toBeNull();
  });

  it("builds dynamic camera, lens, and location selections when metadata is present", () => {
    expect(getCameraFacetSelection({ Make: "FUJIFILM", Model: "X-T5" })).toEqual({
      facetId: "camera",
      value: "FUJIFILM X-T5",
    });
    expect(getCameraFacetSelection({})).toBeNull();
    expect(getLensFacetSelection({ LensModel: "XF23mmF2" })).toEqual({
      facetId: "lens",
      value: "XF23mmF2",
    });
    expect(getLensFacetSelection({})).toBeNull();
    expect(getLocationFacetSelection({ geocode: "Tokyo\nJapan" })).toEqual({
      facetId: "location",
      value: "Japan",
    });
    expect(getLocationFacetSelection(null)).toBeNull();
    expect(getLocationFacetSelection()).toBeNull();
  });
});
