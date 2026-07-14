/**
 * @jest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  fetchColorSimilarResults,
  fetchHybridResults,
  fetchResults,
  fetchSemanticResults,
  fetchSimilarResults,
} from "./api";
import { useTextVector } from "./useTextVector";
import { useSearchResultsState } from "./useSearchResultsState";

jest.mock("use-debounce", () => ({ useDebounce: (value: unknown) => [value] }));
jest.mock("@tanstack/react-query", () => ({
  keepPreviousData: Symbol("keepPreviousData"),
  useInfiniteQuery: jest.fn(),
}));
jest.mock("./useTextVector", () => ({ useTextVector: jest.fn() }));
jest.mock("./api", () => ({
  fetchColorSimilarResults: jest.fn(),
  fetchHybridResults: jest.fn(),
  fetchResults: jest.fn(),
  fetchSemanticResults: jest.fn(),
  fetchSimilarResults: jest.fn(),
}));

const infinite = jest.mocked(useInfiniteQuery);
const textVector = jest.mocked(useTextVector);
const database = { name: "search" } as any;
const embeddingsDatabase = { name: "embeddings" } as any;
const emptyPage = { data: [], prev: undefined, next: undefined };

const baseProps = () => ({
  database,
  embeddingsDatabase,
  searchInputValue: "",
  similarPath: null,
  similarityOrder: "most" as const,
  colorSearch: null,
  colorTolerance: 20,
  searchMode: "keyword" as const,
  selectedFacets: [],
  hasHydratedFromUrl: true,
});

const baseVectorState = () => ({
  textVector: null,
  textVectorQuery: null,
  isTextVectorLoading: false,
  textVectorError: null,
  textModelProgress: 100,
  textModelStage: "Search model ready",
  textModelProgressDetails: { loaded: 0, total: 0 },
});

describe("useSearchResultsState", () => {
  let config: any;

  beforeEach(() => {
    jest.resetAllMocks();
    textVector.mockReturnValue(baseVectorState());
    infinite.mockImplementation((options: any) => {
      config = options;
      return {
        data: { pages: [{ data: [{ path: "one.jpg" }] }, { data: [{ path: "two.jpg" }] }] },
        isSuccess: true,
      } as any;
    });
    for (const fetcher of [
      fetchColorSimilarResults,
      fetchHybridResults,
      fetchResults,
      fetchSemanticResults,
      fetchSimilarResults,
    ]) {
      jest.mocked(fetcher).mockResolvedValue(emptyPage as any);
    }
  });

  const renderState = (
    overrides: Partial<ReturnType<typeof baseProps>> & {
      imageQuery?: { id: number; vector: number[] | null } | null;
      pageSize?: number;
    } = {},
  ) => renderHook(() => useSearchResultsState({ ...baseProps(), ...overrides }));

  it("derives display state and flattens query pages", () => {
    const { result } = renderState({
      searchInputValue: "cats, night",
      colorSearch: [12, 34, 56],
      selectedFacets: [{ facetId: "camera", value: "X-T5" }],
    });
    expect(result.current).toEqual(
      expect.objectContaining({
        canClear: true,
        colorHex: "#0c2238",
        searchQuery: ["cats", " night"],
        debouncedSearchQuery: ["cats", " night"],
        trimmedQuery: "cats  night",
        hasSearchQuery: true,
        hasFacetFilters: true,
        isColorMode: true,
        queryResults: [{ path: "one.jpg" }, { path: "two.jpg" }],
      }),
    );
    expect(textVector).toHaveBeenCalledWith({
      isSimilarMode: false,
      searchMode: "keyword",
      needsTextVector: false,
      trimmedQuery: "cats  night",
    });
  });

  it("derives similar-photo metadata and optional defaults", () => {
    const { result } = renderState({ similarPath: "../albums/test-simple/photo one.jpg" });
    expect(result.current.similarFilename).toBe("photo one.jpg");
    expect(result.current.similarPreviewSrc).toContain("photo one.jpg");
    expect(result.current.isSimilarMode).toBe(true);
    expect(result.current.isImageQueryMode).toBe(false);
    expect(config.queryKey[1]).toEqual(
      expect.objectContaining({ imageQueryId: null, hasImageVector: false }),
    );
  });

  it.each([
    ["not hydrated", { hasHydratedFromUrl: false }, false],
    ["no database", { database: null }, false],
    ["inactive", {}, false],
    ["keyword", { searchInputValue: "cats" }, true],
    ["facets", { selectedFacets: [{ facetId: "camera", value: "X" }] }, true],
    ["pure colour", { colorSearch: [1, 2, 3] as [number, number, number] }, true],
    ["similar", { similarPath: "photo.jpg" }, true],
    ["similar awaiting database", { similarPath: "photo.jpg", embeddingsDatabase: null }, false],
    ["image", { imageQuery: { id: 1, vector: [0.1] } }, true],
    ["image encoding", { imageQuery: { id: 1, vector: null } }, false],
  ])("sets query enablement for %s", (_name, overrides, expected) => {
    renderState(overrides as any);
    expect(config.enabled).toBe(expected);
  });

  it.each([
    ["semantic ready", "semantic", { textVector: [0.1], textVectorQuery: "cats" }, true],
    ["semantic missing DB", "semantic", { textVector: [0.1], textVectorQuery: "cats" }, false],
    ["hybrid ready", "hybrid", { textVector: [0.1], textVectorQuery: "cats" }, true],
    ["failed model", "semantic", { textVectorError: "failed" }, true],
  ])("handles vector enablement for %s", (_name, mode, vector, expected) => {
    textVector.mockReturnValue({ ...baseVectorState(), ...vector } as any);
    renderState({
      searchInputValue: "cats",
      searchMode: mode as "semantic" | "hybrid",
      ...(_name === "semantic missing DB" ? { embeddingsDatabase: null } : {}),
    });
    expect(config.enabled).toBe(expected);
  });

  it("returns an empty page defensively without the primary database", async () => {
    renderState({ database: null });
    await expect(config.queryFn({ pageParam: 2 })).resolves.toEqual(emptyPage);
  });

  it("completes failed pure-semantic work as empty", async () => {
    textVector.mockReturnValue({ ...baseVectorState(), textVectorError: "failed" });
    renderState({ searchInputValue: "cats", searchMode: "semantic" });
    await expect(config.queryFn({ pageParam: 0 })).resolves.toEqual(emptyPage);
  });

  it("holds an image query empty until its vector is ready, then ranks it", async () => {
    renderState({ imageQuery: { id: 4, vector: null }, colorSearch: [1, 2, 3] });
    await expect(config.queryFn({ pageParam: 0 })).resolves.toEqual(emptyPage);

    renderState({ imageQuery: { id: 5, vector: [0.5] }, pageSize: 9 });
    await config.queryFn({ pageParam: 2 });
    expect(fetchSemanticResults).toHaveBeenCalledWith(
      expect.objectContaining({
        textQuery: "image query",
        textVector: [0.5],
        pageSize: 9,
        page: 2,
      }),
    );
  });

  it("routes similar and pure-colour searches", async () => {
    renderState({ similarPath: "photo.jpg", similarityOrder: "least" });
    await config.queryFn({ pageParam: 3 });
    expect(fetchSimilarResults).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "photo.jpg",
        similarityOrder: "least",
        page: 3,
      }),
    );

    renderState({ colorSearch: [10, 20, 30], colorTolerance: 17 });
    await config.queryFn({ pageParam: 1 });
    expect(fetchColorSimilarResults).toHaveBeenCalledWith(
      expect.objectContaining({
        color: [10, 20, 30],
        maxDistance: 17,
        page: 1,
      }),
    );

    textVector.mockReturnValue({ ...baseVectorState(), textVectorError: "failed" });
    renderState({ colorSearch: [10, 20, 30], searchMode: "semantic" });
    await config.queryFn({ pageParam: 2 });
    expect(fetchColorSimilarResults).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });

  it("routes current semantic and hybrid vectors", async () => {
    textVector.mockReturnValue({
      ...baseVectorState(),
      textVector: [0.2],
      textVectorQuery: "cats",
    });
    renderState({ searchInputValue: "cats", searchMode: "semantic" });
    await config.queryFn({ pageParam: 1 });
    expect(fetchSemanticResults).toHaveBeenCalledWith(
      expect.objectContaining({ textQuery: "cats", textVector: [0.2] }),
    );

    renderState({ searchInputValue: "cats", searchMode: "hybrid" });
    await config.queryFn({ pageParam: 2 });
    expect(fetchHybridResults).toHaveBeenCalledWith(
      expect.objectContaining({ keywordQuery: "cats", page: 2 }),
    );
  });

  it("uses keyword/facet search and avoids an unfiltered fetch", async () => {
    renderState();
    await expect(config.queryFn({ pageParam: 0 })).resolves.toEqual(emptyPage);
    expect(fetchResults).not.toHaveBeenCalled();

    renderState({ selectedFacets: [{ facetId: "camera", value: "X-T5" }] });
    await config.queryFn({ pageParam: 4 });
    expect(fetchResults).toHaveBeenCalledWith(expect.objectContaining({ query: "", page: 4 }));
  });

  it("passes through explicit paging cursors", () => {
    renderState();
    expect(config.getPreviousPageParam({ data: [], prev: 2 })).toBe(2);
    expect(config.getPreviousPageParam({ data: [] })).toBeUndefined();
    expect(config.getNextPageParam({ data: [], next: 3 })).toBe(3);
    expect(config.getNextPageParam({ data: [] })).toBeUndefined();
  });
});
