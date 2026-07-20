/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockRetryDatabase = jest.fn();
const mockStartImageQuery = jest.fn();
const mockClearImageQuery = jest.fn();
const mockFetchNextPage = jest.fn();
const mockDatabase = {};
let mockDatabaseState: unknown[];
let mockEmbeddingsState: unknown[];
let mockImageState: Record<string, unknown>;
let mockResultsState: Record<string, unknown>;

const mockFetchTags = jest.fn();
const mockFetchFacets = jest.fn();
const mockFetchRefinements = jest.fn();
const mockFetchRandomPhoto = jest.fn();

jest.mock("../database/useDatabase", () => ({
  useDatabase: () => mockDatabaseState,
  useEmbeddingsDatabase: () => mockEmbeddingsState,
}));

jest.mock("./useImageQuery", () => ({
  useImageQuery: () => mockImageState,
}));

jest.mock("./useSearchResultsState", () => ({
  useSearchResultsState: () => mockResultsState,
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
  fetchRandomPhoto: (...args: unknown[]) => mockFetchRandomPhoto(...args),
  fetchTags: (...args: unknown[]) => mockFetchTags(...args),
  fetchSearchFacetSections: (...args: unknown[]) => mockFetchFacets(...args),
  fetchRefinementTagCounts: (...args: unknown[]) => mockFetchRefinements(...args),
  hasStructuredGeocode: jest.fn(() => true),
}));

jest.mock("./SearchInputBar", () => ({
  SearchInputBar: (props: Record<string, any>) => (
    <div>
      <button type="button" onClick={() => props.onApplySearchTerms(["", "harbor"])}>
        Apply terms
      </button>
      <button type="button" onClick={props.onClearSearchState}>
        Clear all
      </button>
      <button type="button" onClick={props.onOpenDrawPad}>
        Open drawing
      </button>
      <button type="button" onClick={props.onStartRandomSimilarSearch}>
        Start random
      </button>
      <button type="button" onClick={() => props.onPickImageQuery(new File([], "query.jpg"))}>
        Upload image
      </button>
    </div>
  ),
}));

jest.mock("./SearchDrawPad", () => ({
  SearchDrawPad: (props: Record<string, any>) => (
    <div>
      <button type="button" onClick={() => props.onSubmit(new Blob(["drawing"]))}>
        Submit drawing
      </button>
      <button type="button" onClick={props.onCancel}>
        Cancel drawing
      </button>
    </div>
  ),
}));

jest.mock("./SearchFacetPanel", () => ({
  SearchFacetPanel: (props: Record<string, any>) => (
    <div>
      <button type="button" onClick={() => props.onToggleTag("harbor", true)}>
        Remove active tag
      </button>
      <button type="button" onClick={() => props.onToggleTag("night", false)}>
        Add inactive tag
      </button>
      <button type="button" onClick={() => props.onToggleFacet({ facetId: "camera", value: "X" })}>
        Toggle facet
      </button>
      <button type="button" onClick={() => props.onSetColorSearch([1, 2, 3])}>
        Set facet colour
      </button>
      <button type="button" onClick={props.onClearColorSearch}>
        Clear facet colour
      </button>
      <button type="button" onClick={() => props.onSetColorTolerance(50)}>
        Set tolerance
      </button>
      <button type="button" onClick={() => props.onSelectCategory("color")}>
        Select colour category
      </button>
    </div>
  ),
}));

jest.mock("./EmptyStateExplore", () => ({
  EmptyStateExplore: (props: Record<string, any>) => (
    <div>
      <button type="button" onClick={() => props.onStartSimilarSearch("empty.jpg")}>
        Start similar
      </button>
      {props.onSearchByColor ? (
        <button type="button" onClick={() => props.onSearchByColor([9, 8, 7])}>
          Search empty colour
        </button>
      ) : null}
    </div>
  ),
}));

jest.mock("./SearchResultsGrid", () => ({
  SearchResultsGrid: (props: Record<string, any>) => (
    <div>
      <button type="button" onClick={() => props.onFindSimilar("source.jpg", 0.9)}>
        Find current
      </button>
      <button type="button" onClick={() => props.onFindSimilar("next.jpg", 0.8)}>
        Find next
      </button>
      {props.onSearchByColor ? (
        <button type="button" onClick={() => props.onSearchByColor([4, 5, 6])}>
          Search result colour
        </button>
      ) : null}
      <button type="button" onClick={props.onFetchNextPage}>
        Next page
      </button>
      <span data-testid="searching">{String(props.isSearching)}</span>
    </div>
  ),
}));

jest.mock("./SimilarTrailBar", () => ({
  SimilarTrailBar: ({ sourceRef }: { sourceRef: React.RefObject<HTMLDivElement | null> }) => (
    <div ref={sourceRef}>Trail</div>
  ),
}));

jest.mock("./SearchActiveFilters", () => ({
  SearchActiveFilters: (props: Record<string, any>) => (
    <div>
      <button type="button" onClick={props.onClearImage}>
        Clear image
      </button>
      <button type="button" onClick={props.onClearColour}>
        Clear colour
      </button>
      <button type="button" onClick={() => props.onRemoveTerm("harbor")}>
        Remove term
      </button>
      <button type="button" onClick={() => props.onRemoveFacet({ facetId: "camera", value: "X" })}>
        Remove facet
      </button>
    </div>
  ),
}));

jest.mock("../../util/navigate", () => ({ navigateTo: jest.fn() }));

import { Search } from "./Search";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
};

const resetState = () => {
  mockDatabaseState = [mockDatabase, 100, { loaded: 1, total: 1 }, null, mockRetryDatabase];
  mockEmbeddingsState = [mockDatabase, 100, { loaded: 1, total: 1 }, null];
  mockImageState = {
    imageQuery: null,
    imageVectorError: null,
    imageModelProgress: 100,
    imageModelProgressDetails: undefined,
    startImageQuery: mockStartImageQuery,
    clearImageQuery: mockClearImageQuery,
  };
  mockResultsState = {
    canClear: false,
    debouncedSearchQuery: [],
    fetchNextPage: mockFetchNextPage,
    hasNextPage: false,
    isColorMode: false,
    isError: false,
    isFetching: false,
    isPlaceholderData: false,
    isSimilarMode: false,
    isSuccess: true,
    queryResults: [],
    searchQuery: [],
    similarFilename: "source.jpg",
    similarPreviewSrc: "/source.jpg",
    textModelProgress: 100,
    textModelProgressDetails: undefined,
    textVectorError: null,
    trimmedQuery: "",
  };
  mockFetchTags.mockResolvedValue({ data: [] });
  mockFetchFacets.mockResolvedValue([]);
  mockFetchRefinements.mockResolvedValue({});
  mockFetchRandomPhoto.mockResolvedValue([]);
};

describe("Search parent orchestration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/search");
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    resetState();
  });

  afterEach(async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("wires drawing, upload, tag, facet, colour, and paging actions", async () => {
    render(<Search />);
    await act(async () => Promise.resolve());

    fireEvent.click(screen.getByRole("button", { name: "Apply terms" }));
    fireEvent.click(screen.getByRole("button", { name: "Add inactive tag" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove active tag" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle facet" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle facet" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove facet" }));
    fireEvent.click(screen.getByRole("button", { name: "Set facet colour" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear facet colour" }));
    fireEvent.click(screen.getByRole("button", { name: "Set tolerance" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove term" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(mockFetchNextPage).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Upload image" }));
    expect(mockStartImageQuery).toHaveBeenCalledWith(expect.any(File), "upload");
    fireEvent.click(screen.getByRole("button", { name: "Open drawing" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit drawing" }));
    expect(mockStartImageQuery).toHaveBeenCalledWith(expect.any(Blob), "drawing");
  });

  it("starts result colour and similarity actions in browse and similar modes", async () => {
    mockResultsState.onSearchByColor = true;
    const view = render(<Search />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "Select colour category" }));
    fireEvent.click(screen.getByRole("button", { name: "Search result colour" }));
    expect(mockClearImageQuery).toHaveBeenCalled();

    window.history.replaceState({}, "", "/search?similar=source.jpg");
    mockResultsState.isSimilarMode = true;
    view.rerender(<Search />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "Find current" }));
    fireEvent.click(screen.getByRole("button", { name: "Find next" }));
    expect(screen.getByText("Trail")).toBeInTheDocument();
  });

  it("ignores the current similarity source and unavailable random searches", async () => {
    window.history.replaceState({}, "", "/search?similar=source.jpg");
    mockResultsState.isSimilarMode = true;
    const view = render(<Search />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "Find current" }));
    expect(screen.getByText("Trail")).toBeInTheDocument();

    view.unmount();
    window.history.replaceState({}, "", "/search");
    resetState();
    mockDatabaseState = [null, 0, { loaded: 0, total: 1 }, null, mockRetryDatabase];
    render(<Search />);
    fireEvent.click(screen.getByRole("button", { name: "Start random" }));
    expect(mockFetchRandomPhoto).not.toHaveBeenCalled();
  });

  it("runs the non-reduced-motion mode entrance", async () => {
    window.history.replaceState({}, "", "/search?similar=source.jpg");
    mockResultsState.isSimilarMode = true;
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    let frame = 0;
    const requestFrame = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        frame += 1;
        return frame;
      });
    const cancelFrame = jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const view = render(<Search />);
    await act(async () => Promise.resolve());
    expect(screen.getByText("Trail")).toHaveStyle({ opacity: "1" });
    view.unmount();
    expect(cancelFrame).toHaveBeenCalled();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it("reports live facet and refinement failures", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    window.history.replaceState({}, "", "/search?q=harbor&mode=keyword");
    mockResultsState.searchQuery = ["harbor"];
    mockResultsState.debouncedSearchQuery = ["harbor"];
    mockFetchFacets.mockRejectedValue(new Error("facets"));
    mockFetchRefinements.mockRejectedValue(new Error("refinements"));
    render(<Search />);
    await waitFor(() => {
      expect(error).toHaveBeenCalledWith("Failed to fetch search facet catalog", expect.any(Error));
      expect(error).toHaveBeenCalledWith("Failed to fetch search facets", expect.any(Error));
      expect(error).toHaveBeenCalledWith(
        "Failed to fetch refinement tag counts",
        expect.any(Error),
      );
    });
    error.mockRestore();
  });

  it("does not apply facet or refinement results after unmount", async () => {
    window.history.replaceState({}, "", "/search?q=harbor&mode=keyword");
    mockResultsState.searchQuery = ["harbor"];
    mockResultsState.debouncedSearchQuery = ["harbor"];
    const facets = deferred<never[]>();
    const refinements = deferred<Record<string, number>>();
    mockFetchFacets.mockReturnValue(facets.promise);
    mockFetchRefinements.mockReturnValue(refinements.promise);
    const view = render(<Search />);
    view.unmount();
    await act(async () => {
      facets.resolve([]);
      refinements.resolve({ harbor: 1 });
      await Promise.resolve();
    });
  });

  it("ignores facet and refinement failures after unmount", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    window.history.replaceState({}, "", "/search?q=harbor&mode=keyword");
    mockResultsState.searchQuery = ["harbor"];
    mockResultsState.debouncedSearchQuery = ["harbor"];
    const facets = deferred<never[]>();
    const refinements = deferred<Record<string, number>>();
    mockFetchFacets.mockReturnValue(facets.promise);
    mockFetchRefinements.mockReturnValue(refinements.promise);
    const view = render(<Search />);
    view.unmount();
    await act(async () => {
      facets.reject(new Error("facets"));
      refinements.reject(new Error("refinements"));
      await Promise.resolve();
    });
    expect(error).not.toHaveBeenCalledWith(
      expect.stringMatching(/Failed to fetch/),
      expect.anything(),
    );
    error.mockRestore();
  });

  it("renders database, vector, and embedding errors and retries the database", async () => {
    window.history.replaceState({}, "", "/search?q=harbor&mode=semantic");
    mockDatabaseState = [
      mockDatabase,
      100,
      { loaded: 1, total: 1 },
      new Error("database"),
      mockRetryDatabase,
    ];
    mockEmbeddingsState = [null, 0, { loaded: 0, total: 10 }, new Error("embeddings")];
    mockImageState.imageVectorError = "Image encoding failed";
    mockResultsState.textVectorError = "Text encoding failed";
    render(<Search />);
    await act(async () => Promise.resolve());

    expect(screen.getByText("Couldn't load the search index.")).toBeInTheDocument();
    expect(screen.getByText("Text encoding failed")).toBeInTheDocument();
    expect(screen.getByText("Image encoding failed")).toBeInTheDocument();
    expect(screen.getByText("Similarity search is unavailable right now.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockRetryDatabase).toHaveBeenCalled();
  });

  it("reports similarity-index, image-model, and idle loading states", async () => {
    const onNavStateChange = jest.fn();
    window.history.replaceState({}, "", "/search?q=harbor&mode=semantic");
    mockEmbeddingsState = [null, 35, { loaded: 35, total: 100 }, null];
    const view = render(<Search onNavStateChange={onNavStateChange} />);
    await waitFor(() => {
      expect(onNavStateChange.mock.calls.at(-1)?.[0].loading?.activity).toBe(
        "Downloading similarity index",
      );
    });

    mockEmbeddingsState = [mockDatabase, 100, { loaded: 100, total: 100 }, null];
    mockImageState.imageQuery = {
      previewUrl: "blob:query",
      vector: [1],
      source: "upload",
    };
    mockImageState.imageModelProgress = 45;
    view.rerender(<Search onNavStateChange={onNavStateChange} />);
    await waitFor(() => {
      expect(onNavStateChange.mock.calls.at(-1)?.[0].loading?.activity).toBe(
        "Downloading image search model (one-time)",
      );
    });

    mockImageState.imageModelProgress = 100;
    view.rerender(<Search onNavStateChange={onNavStateChange} />);
    await waitFor(() => {
      expect(onNavStateChange.mock.calls.at(-1)?.[0].loading).toBeNull();
    });
  });
});
