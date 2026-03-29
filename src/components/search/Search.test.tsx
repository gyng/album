/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Search from "./Search";
import {
  fetchMemoryCandidates,
  fetchHybridResults,
  fetchRandomPhoto,
  fetchRandomResults,
  fetchRecentResults,
  fetchRefinementTagCounts,
  fetchResults,
  fetchSemanticResults,
  fetchSimilarResults,
  fetchTags,
} from "./api";
import { encodeSearchText } from "./textEmbeddings";
import { warmupTextEmbeddingModel } from "./textEmbeddings";

const mockPush = jest.fn();
const mockUseDatabase = jest.fn();
const mockUseEmbeddingsDatabase = jest.fn();
const mockUseInfiniteQuery = jest.fn();
const originalConsoleError = console.error;

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

jest.mock("next/router", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock("use-debounce", () => ({
  useDebounce: (value: unknown) => [value],
}));

jest.mock("../database/useDatabase", () => ({
  useDatabase: () => mockUseDatabase(),
  useEmbeddingsDatabase: () => mockUseEmbeddingsDatabase(),
}));

jest.mock("@tanstack/react-query", () => ({
  keepPreviousData: Symbol("keepPreviousData"),
  useInfiniteQuery: (...args: unknown[]) => mockUseInfiniteQuery(...args),
}));

jest.mock("./api", () => ({
  fetchMemoryCandidates: jest.fn(),
  fetchHybridResults: jest.fn(),
  fetchRandomPhoto: jest.fn(),
  fetchRandomResults: jest.fn(),
  fetchRecentResults: jest.fn(),
  fetchRefinementTagCounts: jest.fn(),
  fetchResults: jest.fn(),
  fetchSemanticResults: jest.fn(),
  fetchSimilarResults: jest.fn(),
  fetchTags: jest.fn(),
}));

jest.mock("./textEmbeddings", () => ({
  encodeSearchText: jest.fn(),
  warmupTextEmbeddingModel: jest.fn(),
}));

const mockDatabase = { exec: jest.fn() };

const makeResult = (overrides: Record<string, unknown> = {}) => ({
  path: "../albums/test-simple/example.jpg",
  album_relative_path: "/album/test-simple#example.jpg",
  filename: "example.jpg",
  geocode: "",
  exif: "EXIF DateTimeOriginal:2024:02:03 10:20:30",
  tags: "harbor, skyline",
  colors: "[(12, 34, 56)]",
  alt_text: "",
  subject: "",
  snippet: "Example shot",
  ...overrides,
});

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
};

const renderSearch = async () => {
  render(<Search />);
  await flushEffects();
};

const createDeferred = <T,>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return {
    promise,
    resolve: (value: T) => {
      resolve?.(value);
    },
  };
};

const createResolvedThenable = <T,>(value: T) => ({
  then: (onFulfilled?: (resolved: T) => unknown) => {
    const nextValue = onFulfilled ? onFulfilled(value) : value;
    return createResolvedThenable(nextValue as T);
  },
  catch: () => createResolvedThenable(value),
  finally: (onFinally?: () => void) => {
    onFinally?.();
    return createResolvedThenable(value);
  },
});

afterEach(async () => {
  await flushEffects();
});

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation((...args) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("not wrapped in act")
    ) {
      return;
    }

    originalConsoleError(...args);
  });

  window.history.replaceState({}, "", "/search");

  mockUseDatabase.mockReturnValue([
    mockDatabase,
    42,
    { loaded: 2_000_000, total: 4_000_000 },
  ]);
  mockUseEmbeddingsDatabase.mockReturnValue([
    mockDatabase,
    100,
    { loaded: 2_000_000, total: 2_000_000 },
    null,
  ]);
  mockUseInfiniteQuery.mockImplementation((opts: any) => {
    const similarPath = opts?.queryKey?.[1]?.similarPath;
    const searchMode = opts?.queryKey?.[1]?.searchMode;
    const similarResults =
      similarPath === "../albums/test-simple/recent.jpg"
        ? [
            makeResult({
              path: "../albums/test-simple/next.jpg",
              album_relative_path: "/album/test-simple#next.jpg",
              filename: "next.jpg",
              snippet: "Next shot",
              similarity: 0.81,
            }),
          ]
        : similarPath === "../albums/test-simple/next.jpg"
          ? [
              makeResult({
                path: "../albums/test-simple/third.jpg",
                album_relative_path: "/album/test-simple#third.jpg",
                filename: "third.jpg",
                snippet: "Third shot",
                similarity: 0.73,
              }),
            ]
          : [];

    if (opts?.enabled) {
      void opts.queryFn({ pageParam: 0 });
    }

    return {
      data: {
        pages: [
          {
            data:
              similarPath
                ? similarResults
                : searchMode === "semantic"
                  ? [
                      makeResult({
                        path: "../albums/test-simple/semantic.jpg",
                        album_relative_path: "/album/test-simple#semantic.jpg",
                        filename: "semantic.jpg",
                        snippet: "Semantic shot",
                        similarity: 0.88,
                      }),
                    ]
                  : searchMode === "hybrid"
                    ? [
                        makeResult({
                          path: "../albums/test-simple/hybrid.jpg",
                          album_relative_path: "/album/test-simple#hybrid.jpg",
                          filename: "hybrid.jpg",
                          snippet: "Hybrid shot",
                          similarity: 0.82,
                          bm25: 0.7,
                          rrfScore: 0.03,
                        }),
                      ]
                    : [],
            prev: undefined,
            next: undefined,
          },
        ],
      },
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isSuccess: true,
      isFetching: false,
      isPlaceholderData: false,
    };
  });

  (fetchTags as jest.Mock).mockResolvedValue({
    data: [
      { tag: "Harbor", count: 3 },
      { tag: "harbor", count: 1 },
      { tag: "Night", count: 2 },
    ],
  });
  (fetchRecentResults as jest.Mock).mockResolvedValue([
    makeResult({
      path: "../albums/test-simple/recent.jpg",
      album_relative_path: "/album/test-simple#recent.jpg",
      filename: "recent.jpg",
      snippet: "Recent shot",
    }),
  ]);
  (fetchMemoryCandidates as jest.Mock).mockResolvedValue([]);
  (fetchRandomResults as jest.Mock).mockResolvedValue([
    makeResult({
      path: "../albums/test-simple/random.jpg",
      album_relative_path: "/album/test-simple#random.jpg",
      filename: "random.jpg",
      snippet: "Random shot",
    }),
  ]);
  (fetchRandomPhoto as jest.Mock).mockResolvedValue([
    { path: "../albums/test-simple/seed.jpg" },
  ]);
  (fetchRefinementTagCounts as jest.Mock).mockImplementation(
    () => new Promise(() => {}),
  );
  (fetchResults as jest.Mock).mockResolvedValue({
    data: [],
    prev: undefined,
    next: undefined,
  });
  (fetchSemanticResults as jest.Mock).mockResolvedValue({
    data: [],
    prev: undefined,
    next: undefined,
  });
  (fetchHybridResults as jest.Mock).mockResolvedValue({
    data: [],
    prev: undefined,
    next: undefined,
  });
  (fetchSimilarResults as jest.Mock).mockResolvedValue({
    data: [],
    prev: undefined,
    next: undefined,
  });
  (encodeSearchText as jest.Mock).mockResolvedValue([1, 0, 0]);
  (warmupTextEmbeddingModel as jest.Mock).mockResolvedValue(undefined);
});

describe("Search", () => {
  it("renders the browse-mode sections and loading progress", async () => {
    (fetchMemoryCandidates as jest.Mock).mockResolvedValue([
      {
        ...makeResult({
          path: "../albums/test-simple/memory-a.jpg",
          album_relative_path: "/album/test-simple#memory-a.jpg",
          filename: "memory-a.jpg",
          snippet: "Memory shot A",
        }),
        isoDate: "2025-03-13",
      },
      {
        ...makeResult({
          path: "../albums/test-simple/memory-b.jpg",
          album_relative_path: "/album/test-simple#memory-b.jpg",
          filename: "memory-b.jpg",
          snippet: "Memory shot B",
        }),
        isoDate: "2025-03-15",
      },
      {
        ...makeResult({
          path: "../albums/test-simple/memory-c.jpg",
          album_relative_path: "/album/test-simple#memory-c.jpg",
          filename: "memory-c.jpg",
          snippet: "Memory shot C",
        }),
        isoDate: "2024-03-12",
      },
      {
        ...makeResult({
          path: "../albums/test-simple/memory-d.jpg",
          album_relative_path: "/album/test-simple#memory-d.jpg",
          filename: "memory-d.jpg",
          snippet: "Memory shot D",
        }),
        isoDate: "2023-03-11",
      },
    ]);

    await renderSearch();

    await waitFor(() => {
      expect(fetchTags).toHaveBeenCalledWith({
        database: mockDatabase,
        page: 0,
        pageSize: 1000,
        minCount: 1,
      });
    });

    expect(screen.getByText("Latest")).toBeTruthy();
    expect(screen.getByText("Memories")).toBeTruthy();
    expect(screen.getByText("Random selection")).toBeTruthy();
    expect(
      screen.getByText(/keep stacking keywords to narrow results/i),
    ).toBeTruthy();
    expect(screen.getByText(/Loading/)).toBeTruthy();
    expect(screen.getByText("Loading... 1.9 MB / 3.8 MB")).toBeTruthy();
    expect(screen.getByRole("button", { name: /harbor/i })).toBeTruthy();
    expect(await screen.findByAltText("Memory shot A")).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: /open timeline/i })[0]
        ?.getAttribute("href"),
    ).toContain("/timeline?");
    expect(await screen.findByAltText("Recent shot")).toBeTruthy();
    expect(await screen.findByAltText("Random shot")).toBeTruthy();
  });

  it("reveals additional memory clusters on demand", async () => {
    (fetchMemoryCandidates as jest.Mock).mockResolvedValue([
      {
        ...makeResult({
          path: "../albums/test-simple/memory-a.jpg",
          album_relative_path: "/album/test-simple#memory-a.jpg",
          filename: "memory-a.jpg",
          snippet: "Memory shot A",
        }),
        isoDate: "2025-03-20",
      },
      {
        ...makeResult({
          path: "../albums/test-simple/memory-b.jpg",
          album_relative_path: "/album/test-simple#memory-b.jpg",
          filename: "memory-b.jpg",
          snippet: "Memory shot B",
        }),
        isoDate: "2025-03-22",
      },
      {
        ...makeResult({
          path: "../albums/test-simple/memory-c.jpg",
          album_relative_path: "/album/test-simple#memory-c.jpg",
          filename: "memory-c.jpg",
          snippet: "Memory shot C",
        }),
        isoDate: "2024-03-18",
      },
      {
        ...makeResult({
          path: "../albums/test-simple/memory-d.jpg",
          album_relative_path: "/album/test-simple#memory-d.jpg",
          filename: "memory-d.jpg",
          snippet: "Memory shot D",
        }),
        isoDate: "2023-03-17",
      },
    ]);

    await renderSearch();

    expect(screen.queryByAltText("Memory shot D")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /more memories/i }),
    );

    expect(await screen.findByAltText("Memory shot D")).toBeTruthy();
  });

  it("switches from browse mode into similarity mode and back", async () => {
    await renderSearch();

    const similarButtons = await screen.findAllByRole("button", {
      name: /find similar photos/i,
    });

    fireEvent.click(similarButtons[0]);

    expect(
      await screen.findByRole("button", {
        name: /clear current similarity selection/i,
      }),
    ).toBeTruthy();
    expect(screen.getByAltText("Source photo recent.jpg")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: /clear current similarity selection/i,
      }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: /clear current similarity selection/i,
        }),
      ).toBeNull();
    });
  });

  it("clearing a breadcrumb makes the next older entry current", async () => {
    await renderSearch();

    const browseSimilarButtons = await screen.findAllByRole("button", {
      name: /find similar photos/i,
    });
    fireEvent.click(browseSimilarButtons[0]);

    let resultSimilarButton = await screen.findByRole("button", {
      name: /find similar photos/i,
    });
    fireEvent.click(resultSimilarButton);

    resultSimilarButton = await screen.findByRole("button", {
      name: /find similar photos/i,
    });
    fireEvent.click(resultSimilarButton);

    expect(screen.getByAltText("Source photo third.jpg")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /remove next.jpg from breadcrumbs/i }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /remove next.jpg from breadcrumbs/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /clear current similarity selection/i,
        }),
      ).toBeTruthy();
    });

    expect(screen.getByAltText("Source photo recent.jpg")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: /remove next.jpg from breadcrumbs/i,
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /remove recent.jpg from breadcrumbs/i,
      }),
    ).toBeNull();
  });

  it("clearing the current similarity selection only pops the active item", async () => {
    await renderSearch();

    const browseSimilarButtons = await screen.findAllByRole("button", {
      name: /find similar photos/i,
    });
    fireEvent.click(browseSimilarButtons[0]);

    let resultSimilarButton = await screen.findByRole("button", {
      name: /find similar photos/i,
    });
    fireEvent.click(resultSimilarButton);

    resultSimilarButton = await screen.findByRole("button", {
      name: /find similar photos/i,
    });
    fireEvent.click(resultSimilarButton);

    expect(screen.getByAltText("Source photo third.jpg")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /remove next.jpg from breadcrumbs/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /remove recent.jpg from breadcrumbs/i,
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: /clear current similarity selection/i,
      }),
    );

    await waitFor(() => {
      expect(screen.getByAltText("Source photo next.jpg")).toBeTruthy();
    });

    expect(
      screen.queryByRole("button", { name: /remove next.jpg from breadcrumbs/i }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: /remove recent.jpg from breadcrumbs/i,
      }),
    ).toBeTruthy();
  });

  it("switches into refinement mode when a browse tag is clicked", async () => {
    const refinementCounts = createDeferred<Record<string, number>>();
    (fetchRefinementTagCounts as jest.Mock).mockReturnValue(refinementCounts.promise);

    await renderSearch();

    fireEvent.click(await screen.findByRole("button", { name: /harbor/i }));

    await waitFor(() => {
      expect(fetchRefinementTagCounts).toHaveBeenCalledWith({
        database: mockDatabase,
        activeTerms: ["harbor"],
        candidateTags: ["harbor", "night"],
      });
    });

    await act(async () => {
      refinementCounts.resolve({ harbor: 1, night: 0 });
    });

    expect(screen.queryByText("Latest")).toBeNull();
    expect(screen.queryByText("Random selection")).toBeNull();
  });

  it("preserves typed spaces in the search input", async () => {
    await renderSearch();

    const input = screen.getByPlaceholderText(
      /type \/ to search/i,
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "new" } });
    expect(input.value).toBe("new");

    fireEvent.change(input, { target: { value: "new " } });
    expect(input.value).toBe("new ");

    fireEvent.change(input, { target: { value: "new york" } });
    expect(input.value).toBe("new york");
  });

  it("hydrates semantic mode from the URL and encodes the text query", async () => {
    window.history.replaceState({}, "", "/search?q=harbor&mode=semantic");
    (encodeSearchText as jest.Mock).mockReturnValue(
      createResolvedThenable([1, 0, 0]),
    );

    await renderSearch();

    await waitFor(() => {
      expect(encodeSearchText).toHaveBeenCalledWith(
        "harbor",
        expect.any(Function),
      );
    });

    expect(
      (screen.getByLabelText("Search mode") as HTMLSelectElement).value,
    ).toBe("semantic");

    await waitFor(() => {
      expect(fetchSemanticResults).toHaveBeenCalledWith(
        expect.objectContaining({
          database: mockDatabase,
          textQuery: "harbor",
          textVector: [1, 0, 0],
        }),
      );
    });
  });

  it("defaults to hybrid mode and dispatches hybrid search", async () => {
    window.history.replaceState({}, "", "/search?q=harbor");
    (encodeSearchText as jest.Mock).mockReturnValue(
      createResolvedThenable([1, 0, 0]),
    );

    await renderSearch();

    expect(
      (screen.getByLabelText("Search mode") as HTMLSelectElement).value,
    ).toBe("hybrid");

    await waitFor(() => {
      expect(encodeSearchText).toHaveBeenCalledWith(
        "harbor",
        expect.any(Function),
      );
    });

    await waitFor(() => {
      expect(fetchHybridResults).toHaveBeenCalledWith(
        expect.objectContaining({
          database: mockDatabase,
          textQuery: "harbor",
          keywordQuery: "harbor",
          textVector: [1, 0, 0],
        }),
      );
    });
  });

  it("does not reuse a stale semantic vector after the input changes", async () => {
    const marinaVector = createDeferred<number[]>();
    (encodeSearchText as jest.Mock).mockImplementation((text: string) => {
      if (text === "harbor") {
        return createResolvedThenable([1, 0, 0]);
      }

      if (text === "marina") {
        return marinaVector.promise;
      }

      return Promise.resolve([0, 0, 1]);
    });

    window.history.replaceState({}, "", "/search?q=harbor&mode=semantic");

    await renderSearch();

    await waitFor(() => {
      expect(fetchSemanticResults).toHaveBeenCalledWith(
        expect.objectContaining({
          textQuery: "harbor",
          textVector: [1, 0, 0],
        }),
      );
    });

    const input = screen.getByPlaceholderText(
      /type \/ to search/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "marina" } });

    await waitFor(() => {
      expect(encodeSearchText).toHaveBeenCalledWith(
        "marina",
        expect.any(Function),
      );
    });

    expect(fetchSemanticResults).not.toHaveBeenCalledWith(
      expect.objectContaining({
        textQuery: "marina",
      }),
    );

    await act(async () => {
      marinaVector.resolve([0, 1, 0]);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchSemanticResults).toHaveBeenCalledWith(
        expect.objectContaining({
          textQuery: "marina",
          textVector: [0, 1, 0],
        }),
      );
    });
  });

  it("shows model download sizes while warming semantic search", async () => {
    window.history.replaceState({}, "", "/search?mode=semantic");

    let resolveWarmup: (() => void) | null = null;
    (warmupTextEmbeddingModel as jest.Mock).mockImplementation(
      (
        onProgress?: (
          progress: number,
          stage: string,
          details?: { loaded: number; total: number; file?: string },
        ) => void,
      ) => {
        onProgress?.(50, "Loading text model (text_model.onnx)", {
          loaded: 2 * 1024 * 1024,
          total: 4 * 1024 * 1024,
          file: "text_model.onnx",
        });

        return new Promise<void>((resolve) => {
          resolveWarmup = resolve;
        });
      },
    );

    await renderSearch();

    expect(await screen.findByText("Loading... 2.0 MB / 4.0 MB")).toBeTruthy();

    await act(async () => {
      resolveWarmup?.();
    });
  });

  it("includes database readiness in the query key so the key changes when the DB loads", async () => {
    mockUseDatabase.mockReturnValue([null, 0, { loaded: 0, total: 0 }]);
    window.history.replaceState({}, "", "/search?q=harbor&mode=keyword");

    const { rerender } = render(<Search />);
    await flushEffects();

    const callsBeforeLoad = mockUseInfiniteQuery.mock.calls.length;
    const keyBeforeLoad =
      mockUseInfiniteQuery.mock.calls[callsBeforeLoad - 1][0].queryKey;

    mockUseDatabase.mockReturnValue([
      mockDatabase,
      100,
      { loaded: 0, total: 0 },
    ]);
    rerender(<Search />);
    await flushEffects();

    const keyAfterLoad =
      mockUseInfiniteQuery.mock.calls[
        mockUseInfiniteQuery.mock.calls.length - 1
      ][0].queryKey;

    expect(keyAfterLoad).not.toEqual(keyBeforeLoad);
  });
});
