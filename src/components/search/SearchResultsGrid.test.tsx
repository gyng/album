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

const result = (path: string, similarity?: number): SearchResultRow =>
  ({
    path,
    album_relative_path: `/album/test-simple#${path}`,
    filename: path,
    ...(similarity === undefined ? {} : { similarity }),
  }) as unknown as SearchResultRow;

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

  it("keeps an inactive search empty aside from the persistent status region", () => {
    const { container } = render(<SearchResultsGrid {...baseProps} />);
    const ul = container.querySelector("ul");
    expect(ul?.querySelectorAll("li:not([role='status'])")).toHaveLength(0);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
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
      <SearchResultsGrid {...baseProps} searchInputValue="query" isError isFetching isSearching />,
    );
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
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

    const items = container.querySelectorAll("li:not([role='status'])");
    expect(items[0]).toHaveStyle({ filter: "saturate(0.5) grayscale(1)", opacity: "0.55" });
    expect(items[1]).toHaveStyle({ filter: "saturate(0.5)", opacity: "1" });
    expect(tileProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ persistColorAction: true }),
    );
    // getAllByRole throws if empty, so the first button exists
    fireEvent.click(screen.getAllByRole("button", { name: "Similar" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Colour" })[0]!);
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
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  });

  it("keeps a persistent live region for the searching status across the inactive-to-active transition", () => {
    // Starts inactive (bare-ul path, showResults false) — the status node
    // must already exist here, not mount for the first time once a query
    // starts, or a screen reader misses the first "Searching…" announcement.
    const view = render(<SearchResultsGrid {...baseProps} />);
    const status = screen.getByRole("status");
    const ul = status.closest("ul");
    expect(status).toBeEmptyDOMElement();
    // aria-busy belongs on the ul, not the status node itself — aria-busy=true
    // on the status region would tell assistive tech to defer announcing
    // changes inside it, withholding the very "Searching…" text it exists to
    // announce.
    expect(status).not.toHaveAttribute("aria-busy");
    expect(ul).toHaveAttribute("aria-busy", "false");

    view.rerender(
      <SearchResultsGrid
        {...baseProps}
        searchInputValue="query"
        trimmedQuery="query"
        isSearching
      />,
    );
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Searching…");
    expect(status).not.toHaveAttribute("aria-busy");
    expect(ul).toHaveAttribute("aria-busy", "true");

    view.rerender(
      <SearchResultsGrid {...baseProps} searchInputValue="query" trimmedQuery="query" />,
    );
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toBeEmptyDOMElement();

    // Clearing the input back to inactive must not unmount it either.
    view.rerender(<SearchResultsGrid {...baseProps} />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toBeEmptyDOMElement();
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

  it("does not add a displacing progress row once results are on screen", () => {
    // The visible progress row is full-width and in-flow: rendered above
    // existing tiles it would shove them down and snap them back when the
    // search resolves. While the grid is still empty it has nothing below to
    // displace, so it may show (it is the only aria-hidden list item).
    const view = render(
      <SearchResultsGrid
        {...baseProps}
        searchInputValue="query"
        trimmedQuery="query"
        results={[]}
        isSearching
      />,
    );
    expect(view.container.querySelectorAll("li[aria-hidden='true']")).toHaveLength(1);

    // Refining over previous results (kept in place, desaturated) must not
    // reintroduce that row — progress stays conveyed by the live region.
    view.rerender(
      <SearchResultsGrid
        {...baseProps}
        searchInputValue="query"
        trimmedQuery="query"
        results={[result("previous.jpg")]}
        isSuccess
        isFetching
        isSearching
        isPlaceholderData
      />,
    );
    expect(view.container.querySelectorAll("li[aria-hidden='true']")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  });
});
