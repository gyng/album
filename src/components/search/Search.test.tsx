import React, { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Search } from "./Search";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("use-debounce", () => ({
  useDebounce: (value: string[]) => [value],
}));

jest.mock("@tanstack/react-query", () => ({
  keepPreviousData: undefined,
  useInfiniteQuery: () => ({
    data: undefined,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isSuccess: false,
    isFetching: false,
    isPlaceholderData: false,
  }),
}));

jest.mock("./api", () => ({
  fetchResults: jest.fn(),
  fetchSimilarResults: jest.fn(),
  fetchTags: jest.fn(() => Promise.resolve({ data: [] })),
}));

jest.mock("../database/useDatabase", () => ({
  useDatabase: () => [null, null],
}));

jest.mock("../ProgressBar", () => ({
  ProgressBar: () => <div data-testid="progress-bar" />,
}));

jest.mock("./SearchResultTile", () => ({
  SearchResultTile: () => null,
}));

jest.mock("./SearchTag", () => ({
  SearchTag: () => null,
}));

describe("Search", () => {
  afterEach(() => {
    window.history.replaceState(window.history.state, "", "/search");
    document.body.innerHTML = "";
  });

  it("hydrates cleanly before syncing URL state into the input", async () => {
    window.history.replaceState(window.history.state, "", "/search");
    const serverMarkup = renderToString(<Search />);

    window.history.replaceState(window.history.state, "", "/search?q=bird");
    document.body.innerHTML = `<div id="root">${serverMarkup}</div>`;

    const container = document.getElementById("root");
    expect(container).not.toBeNull();

    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      hydrateRoot(container!, <Search />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
    const input = container?.querySelector("input");
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).value).toBe("bird");

    consoleError.mockRestore();
  });
});