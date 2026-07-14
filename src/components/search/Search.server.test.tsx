/**
 * @jest-environment node
 */

import { renderToString } from "react-dom/server";

jest.mock("../database/useDatabase", () => ({
  useDatabase: () => [null, 0, undefined, null, jest.fn()],
  useEmbeddingsDatabase: () => [null, 0, undefined, null],
}));
jest.mock("./useImageQuery", () => ({
  useImageQuery: () => ({
    imageQuery: null,
    imageVectorError: null,
    imageModelProgress: 100,
    imageModelProgressDetails: undefined,
    startImageQuery: jest.fn(),
    clearImageQuery: jest.fn(),
  }),
}));
jest.mock("./useSearchResultsState", () => ({
  useSearchResultsState: () => ({
    canClear: false,
    debouncedSearchQuery: [],
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isColorMode: false,
    isError: false,
    isFetching: false,
    isPlaceholderData: false,
    isSimilarMode: false,
    isSuccess: true,
    queryResults: [],
    searchQuery: [],
    similarFilename: "",
    similarPreviewSrc: "",
    textModelProgress: 100,
    textModelProgressDetails: undefined,
    textVectorError: null,
    trimmedQuery: "",
  }),
}));
jest.mock("./useSearchFilterDrawer", () => ({
  useSearchFilterDrawer: () => ({
    isOpen: false,
    open: jest.fn(),
    close: jest.fn(),
    triggerRef: { current: null },
    closeRef: { current: null },
  }),
}));
jest.mock("./api", () => ({
  fetchRandomPhoto: jest.fn(),
  fetchRefinementTagCounts: jest.fn(),
  fetchSearchFacetSections: jest.fn(),
  fetchTags: jest.fn(),
  hasStructuredGeocode: jest.fn(() => false),
}));
jest.mock("./SearchInputBar", () => ({ SearchInputBar: () => null }));
jest.mock("./SearchFacetPanel", () => ({ SearchFacetPanel: () => null }));
jest.mock("./SearchResultsGrid", () => ({ SearchResultsGrid: () => null }));
jest.mock("./SimilarTrailBar", () => ({ SimilarTrailBar: () => null }));
jest.mock("./SearchDrawPad", () => ({ SearchDrawPad: () => null }));
jest.mock("./EmptyStateExplore", () => ({ EmptyStateExplore: () => null }));
jest.mock("./SearchActiveFilters", () => ({ SearchActiveFilters: () => null }));

import Search, { Search as NamedSearch } from "./Search";

describe("Search server rendering", () => {
  it("uses the server-safe effect and renders without browser globals", () => {
    expect(Search).toBe(NamedSearch);
    expect(renderToString(<Search />)).toContain("searchWidget");
  });
});
