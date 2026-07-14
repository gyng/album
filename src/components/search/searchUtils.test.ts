import type React from "react";
import {
  DEFAULT_SEARCH_MODE,
  DEFAULT_SIMILARITY_ORDER,
  dedupeTags,
  forceDocumentNavigation,
  getInitialSearchState,
  isSearchMode,
  isSimilarityOrder,
  parseColorParam,
  parseSearchTerms,
  similarSearchEmojiStyle,
} from "./searchUtils";

describe("searchUtils", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("deduplicates tag names case-insensitively while summing counts", () => {
    expect(
      dedupeTags([
        { name: "Cat", count: 2 },
        { name: "cat", count: 3 },
        { name: "NIGHT", count: 4 },
      ]),
    ).toEqual([
      { name: "cat", count: 5 },
      { name: "night", count: 4 },
    ]);
  });

  it("parses the URL-level search value without changing its comma semantics", () => {
    expect(parseSearchTerms("")).toEqual([]);
    expect(parseSearchTerms("cat, night")).toEqual(["cat", " night"]);
  });

  it("recognises supported search modes and similarity directions", () => {
    expect(DEFAULT_SEARCH_MODE).toBe("hybrid");
    expect(DEFAULT_SIMILARITY_ORDER).toBe("most");
    expect(similarSearchEmojiStyle).toEqual({ filter: "grayscale(100%)" });
    expect(["keyword", "semantic", "hybrid"].every(isSearchMode)).toBe(true);
    expect(isSearchMode("unknown")).toBe(false);
    expect(isSearchMode(null)).toBe(false);
    expect(isSimilarityOrder("most")).toBe(true);
    expect(isSimilarityOrder("least")).toBe(true);
    expect(isSimilarityOrder("random")).toBe(false);
    expect(isSimilarityOrder(null)).toBe(false);
  });

  it("accepts only complete RGB colour parameters within byte range", () => {
    expect(parseColorParam(null)).toBeNull();
    expect(parseColorParam("")).toBeNull();
    expect(parseColorParam("1,2")).toBeNull();
    expect(parseColorParam("x,2,3")).toBeNull();
    expect(parseColorParam("-1,2,3")).toBeNull();
    expect(parseColorParam("256,2,3")).toBeNull();
    expect(parseColorParam(" 12, 34, 56 ")).toEqual([12, 34, 56]);
  });

  it("returns an unhydrated default during server rendering", () => {
    expect(getInitialSearchState()).toEqual({
      searchQuery: [],
      similarPath: null,
      similarityOrder: "most",
      colorSearch: null,
      searchMode: "hybrid",
      selectedFacets: [],
      hasHydratedFromUrl: false,
    });
  });

  it("hydrates valid URL search state and falls back for invalid options", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          toString: () =>
            "https://gallery.test/search?q=cat%2Cnight&similar=photo.jpg&similar_order=least&color=12%2C34%2C56&mode=semantic&facet=location%3AJapan",
        },
      },
    });

    expect(getInitialSearchState()).toEqual({
      searchQuery: ["cat", "night"],
      similarPath: "photo.jpg",
      similarityOrder: "least",
      colorSearch: [12, 34, 56],
      searchMode: "semantic",
      selectedFacets: [{ facetId: "location", value: "Japan" }],
      hasHydratedFromUrl: true,
    });

    window.location.toString = () =>
      "https://gallery.test/search?similar_order=random&mode=unknown&color=bad";
    expect(getInitialSearchState()).toMatchObject({
      searchQuery: [],
      similarityOrder: "most",
      colorSearch: null,
      searchMode: "hybrid",
      hasHydratedFromUrl: true,
    });
  });

  it("forces a full document navigation for cross-origin-isolated page exits", () => {
    const preventDefault = jest.fn();
    const assign = jest.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { assign } },
    });

    forceDocumentNavigation(
      { preventDefault } as unknown as React.MouseEvent<HTMLAnchorElement>,
      "/map",
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/map");
  });
});
