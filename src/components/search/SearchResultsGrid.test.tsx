/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { SearchResultRow } from "./searchTypes";
import { SearchResultsGrid } from "./SearchResultsGrid";

const tileProps = jest.fn();
jest.mock("./SearchResultTile", () => ({
  SearchResultTile: (props: {
    result: SearchResultRow;
    onFindSimilar: (path: string, similarity?: number) => void;
    onSearchByColor?: (color: [number, number, number]) => void;
  }) => {
    tileProps(props);
    return (
      <div>
        <span>{props.result.path}</span>
        <button
          type="button"
          onClick={() => props.onFindSimilar(props.result.path, props.result.similarity)}
        >
          Similar
        </button>
        {props.onSearchByColor ? (
          <button type="button" onClick={() => props.onSearchByColor?.([1, 2, 3])}>
            Colour
          </button>
        ) : null}
      </div>
    );
  },
}));

const result = (path: string, similarity?: number): SearchResultRow => ({
  path,
  album_relative_path: `/album/test-simple#${path}`,
  filename: path,
  ...(similarity === undefined ? {} : { similarity }),
});

const baseProps = {
  isSimilarMode: false,
  isColorMode: false,
  isImageQueryMode: false,
  isColorCategoryActive: false,
  hasFacetFilters: false,
  searchInputValue: "",
  trimmedQuery: "",
  similarPath: null,
  results: undefined,
  isSuccess: false,
  isError: false,
  isFetching: false,
  isSearching: false,
  isPlaceholderData: false,
  hasNextPage: false,
  similarClickstreamPaths: new Set<string>(),
  onFindSimilar: jest.fn(),
  onFetchNextPage: jest.fn(),
};

describe("SearchResultsGrid", () => {
  beforeEach(() => {
    tileProps.mockClear();
    baseProps.onFindSimilar.mockClear();
    baseProps.onFetchNextPage.mockClear();
  });

  it("keeps an inactive search empty", () => {
    const { container } = render(<SearchResultsGrid {...baseProps} />);
    expect(container.querySelector("ul")).toBeEmptyDOMElement();
  });

  it.each([
    [
      "similar",
      { isSimilarMode: true, similarPath: "albums/test/photo.jpg" },
      "No similar results for",
      "photo.jpg",
    ],
    ["colour", { isColorMode: true }, "No photos with a similar colour found.", null],
    ["text", { searchInputValue: "birds", trimmedQuery: "birds" }, "No results for", "birds"],
    ["facets", { hasFacetFilters: true }, "No results for the selected filters.", null],
    ["image", { isImageQueryMode: true }, "No results for the selected filters.", null],
    [
      "colour with facets",
      { isColorMode: true, hasFacetFilters: true },
      "No results for the selected filters.",
      null,
    ],
  ])("reports an empty %s search", (_name, mode, message, detail) => {
    render(<SearchResultsGrid {...baseProps} {...mode} results={[]} isSuccess />);
    expect(screen.getByText(message, { exact: false })).toBeInTheDocument();
    if (detail) expect(screen.getByText(detail)).toBeInTheDocument();
  });

  it("handles a similar search whose source path is unavailable", () => {
    render(<SearchResultsGrid {...baseProps} isSimilarMode results={[]} isSuccess />);
    expect(screen.getByText("No similar results for", { exact: false })).toBeInTheDocument();
  });

  it("shows errors only after fetching settles", () => {
    const view = render(<SearchResultsGrid {...baseProps} searchInputValue="query" isError />);
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();

    view.rerender(
      <SearchResultsGrid
        {...baseProps}
        searchInputValue="query"
        isError
        isFetching
        isSearching
      />,
    );
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
    expect(screen.getByText("Searching…")).toBeInTheDocument();
  });

  it("renders results, forwards actions, and distinguishes trail members", () => {
    const onSearchByColor = jest.fn();
    const { container } = render(
      <SearchResultsGrid
        {...baseProps}
        isSimilarMode
        isColorCategoryActive
        results={[result("visited.jpg", 0.8), result("fresh.jpg")]}
        isSuccess
        isPlaceholderData
        similarClickstreamPaths={new Set(["visited.jpg"])}
        onSearchByColor={onSearchByColor}
      />,
    );

    const items = container.querySelectorAll("li");
    expect(items[0]).toHaveStyle({ filter: "saturate(0.5) grayscale(1)", opacity: "0.55" });
    expect(items[1]).toHaveStyle({ filter: "saturate(0.5)", opacity: "1" });
    expect(tileProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ persistColorAction: true }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Similar" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Colour" })[0]);
    expect(baseProps.onFindSimilar).toHaveBeenCalledWith("visited.jpg", 0.8);
    expect(onSearchByColor).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("offers paging and reflects an in-flight next page", () => {
    const view = render(
      <SearchResultsGrid
        {...baseProps}
        searchInputValue="query"
        results={[result("one.jpg")]}
        isSuccess
        hasNextPage
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More…" }));
    expect(baseProps.onFetchNextPage).toHaveBeenCalledTimes(1);

    view.rerender(
      <SearchResultsGrid
        {...baseProps}
        searchInputValue="query"
        results={[result("one.jpg")]}
        isSuccess
        isFetching
        hasNextPage
      />,
    );
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  });

  it("shows deferred vector work as searching even after a prior success", () => {
    render(
      <SearchResultsGrid
        {...baseProps}
        isImageQueryMode
        results={undefined}
        isSuccess
        isSearching
      />,
    );
    expect(screen.getByText("Searching…")).toBeInTheDocument();
  });

  it("keeps search progress visible while showing results from the previous query", () => {
    render(
      <SearchResultsGrid
        {...baseProps}
        searchInputValue="new query"
        trimmedQuery="new query"
        results={[result("previous.jpg")]}
        isSuccess
        isFetching
        isSearching
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
    expect(screen.getByText("previous.jpg")).toBeInTheDocument();
  });
});
