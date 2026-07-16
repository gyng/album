/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmptyStateExplore } from "./EmptyStateExplore";
import { fetchMemoryCandidates, fetchRandomResults, fetchRecentResults } from "./api";
import { getMemoryClusters } from "../../util/clusterByDate";

jest.mock("./api", () => ({
  fetchMemoryCandidates: jest.fn(),
  fetchRecentResults: jest.fn(),
  fetchRandomResults: jest.fn(),
}));

jest.mock("../../util/clusterByDate", () => ({
  formatMemoryDateRange: (start: string, end: string) =>
    start === end ? start : `${start} to ${end}`,
  getMemoryClusters: jest.fn(),
}));

jest.mock("./SearchResultTile", () => ({
  SearchResultTile: ({ result, onFindSimilar, onSearchByColor, persistColorAction }: any) => (
    <div data-testid={`tile-${result.path}`} data-persist-colour={String(persistColorAction)}>
      <button type="button" onClick={() => onFindSimilar(result.path)}>
        Similar {result.path}
      </button>
      {onSearchByColor ? (
        <button type="button" onClick={() => onSearchByColor([1, 2, 3])}>
          Colour {result.path}
        </button>
      ) : null}
    </div>
  ),
}));

const mockMemory = fetchMemoryCandidates as jest.MockedFunction<typeof fetchMemoryCandidates>;
const mockRecent = fetchRecentResults as jest.MockedFunction<typeof fetchRecentResults>;
const mockRandom = fetchRandomResults as jest.MockedFunction<typeof fetchRandomResults>;
const mockClusters = getMemoryClusters as jest.MockedFunction<typeof getMemoryClusters>;
const database = {} as any;

const row = (path: string, album = "japan") =>
  ({
    path,
    album_relative_path: `/album/${album}#${path}`,
    thumbnail_path: `/${path}.jpg`,
    title: path,
    isoDate: "2024-07-14T10:00:00",
  }) as any;

const rows = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => row(`${prefix}-${index}`));

describe("EmptyStateExplore", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockMemory.mockResolvedValue([] as any);
    mockRecent.mockResolvedValue([] as any);
    mockRandom.mockResolvedValue([] as any);
    mockClusters.mockReturnValue([] as any);
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("resets to loading without a database and reports empty database results", async () => {
    const { rerender } = render(
      <EmptyStateExplore database={null} onStartSimilarSearch={jest.fn()} />,
    );
    expect(screen.getByText("Loading recent photos…")).toBeTruthy();
    expect(screen.getByText("Loading random photos…")).toBeTruthy();
    expect(mockRecent).not.toHaveBeenCalled();

    rerender(<EmptyStateExplore database={database} onStartSimilarSearch={jest.fn()} />);
    expect(await screen.findByText("No dated photos available yet.")).toBeTruthy();
    expect(await screen.findByText("No random photos available yet.")).toBeTruthy();
  });

  it("shows independent memory, recent, and random load failures", async () => {
    mockMemory.mockRejectedValueOnce(new Error("memories failed"));
    mockRecent.mockRejectedValueOnce(new Error("recent failed"));
    mockRandom.mockRejectedValueOnce(new Error("random failed"));

    render(<EmptyStateExplore database={database} onStartSimilarSearch={jest.fn()} />);

    expect(await screen.findByText("Couldn't load recent photos right now.")).toBeTruthy();
    expect(await screen.findByText("Couldn't load random photos right now.")).toBeTruthy();
    await waitFor(() => expect(consoleError).toHaveBeenCalledTimes(3));
  });

  it("renders memories and result actions, then loads more of every section", async () => {
    const recent = rows("recent", 15);
    const random = rows("random", 7);
    mockRecent
      .mockResolvedValueOnce(recent as any)
      .mockResolvedValueOnce(rows("recent-next", 4) as any);
    mockRandom
      .mockResolvedValueOnce(random as any)
      .mockResolvedValueOnce(rows("random-next", 3) as any);
    mockMemory.mockResolvedValueOnce([row("memory-source")] as any);
    mockClusters.mockReturnValue([
      {
        year: 2025,
        yearsAgo: 1,
        startDate: "2025-07-14",
        endDate: "2025-07-14",
        items: [row("memory-a"), row("memory-b")],
      },
      {
        year: 2023,
        yearsAgo: 3,
        startDate: "2023-07-13",
        endDate: "2023-07-15",
        items: [
          row("memory-c", "france"),
          {
            ...row("memory-d", "iceland"),
            album_relative_path: "/not-an-album",
            path: "/albums/iceland/memory-d.jpg",
          },
          {
            ...row("memory-unknown", "unknown"),
            album_relative_path: "/not-an-album",
            path: "memory-unknown.jpg",
          },
        ],
      },
      {
        year: 2020,
        yearsAgo: 6,
        startDate: "2020-07-14",
        endDate: "2020-07-14",
        items: [row("memory-e")],
      },
    ] as any);
    const onStartSimilarSearch = jest.fn();
    const onSearchByColor = jest.fn();

    render(
      <EmptyStateExplore
        database={database}
        onStartSimilarSearch={onStartSimilarSearch}
        onSearchByColor={onSearchByColor}
        isColorCategoryActive
      />,
    );

    expect(await screen.findByText(/1 year ago · japan/)).toBeTruthy();
    expect(screen.getByText(/3 years ago/)).toBeTruthy();
    expect(screen.queryByText(/6 years ago/)).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "Open timeline" })[0].getAttribute("href"),
    ).toContain("filter_album=japan");
    expect(
      screen.getAllByRole("link", { name: "Open timeline" })[1].getAttribute("href"),
    ).not.toContain("filter_album");

    fireEvent.click(screen.getByRole("button", { name: "Similar recent-0" }));
    fireEvent.click(screen.getByRole("button", { name: "Colour recent-0" }));
    fireEvent.click(screen.getByRole("button", { name: "Similar memory-a" }));
    expect(onStartSimilarSearch.mock.calls).toEqual([["recent-0"], ["memory-a"]]);
    expect(onSearchByColor).toHaveBeenCalledWith([1, 2, 3]);
    expect(screen.getByTestId("tile-recent-0").getAttribute("data-persist-colour")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "More memories…" }));
    expect(await screen.findByText(/6 years ago/)).toBeTruthy();

    const moreButtons = screen.getAllByRole("button", { name: "More…" });
    fireEvent.click(moreButtons[0]);
    await waitFor(() => expect(mockRecent).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "More…" }));
    await waitFor(() => expect(mockRandom).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Similar random-next-0" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Similar random-next-0" }));
    expect(onStartSimilarSearch).toHaveBeenLastCalledWith("random-next-0");
  });

  it("automatically extends random results when the load-more sentinel intersects", async () => {
    let observerCallback: IntersectionObserverCallback | null = null;
    const observe = jest.fn();
    const disconnect = jest.fn();
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve = jest.fn();
      root = null;
      rootMargin = "160px 0px";
      thresholds = [0.1];
      takeRecords = () => [];
    }
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
    let resolveAuto!: (value: any[]) => void;
    mockRandom
      .mockResolvedValueOnce(rows("initial", 7) as any)
      .mockReturnValueOnce(new Promise((resolve) => (resolveAuto = resolve)) as any);

    render(<EmptyStateExplore database={database} onStartSimilarSearch={jest.fn()} />);
    await screen.findByRole("button", { name: "More…" });
    expect(observe).toHaveBeenCalled();

    act(() => {
      observerCallback?.([{} as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(mockRandom).toHaveBeenCalledTimes(1);
    act(() => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => expect(mockRandom).toHaveBeenCalledTimes(2));
    expect(disconnect).toHaveBeenCalled();
    await act(async () => {
      resolveAuto(rows("auto", 8));
      await Promise.resolve();
    });
    expect(await screen.findByRole("button", { name: "Similar auto-0" })).toBeTruthy();
  });

  it("reports a load-more failure and allows a later manual retry", async () => {
    let rejectMore!: (reason: Error) => void;
    mockRandom
      .mockResolvedValueOnce(rows("initial", 7) as any)
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectMore = reject;
        }) as any,
      )
      .mockResolvedValueOnce(rows("retry", 2) as any);
    render(<EmptyStateExplore database={database} onStartSimilarSearch={jest.fn()} />);

    const more = await screen.findByRole("button", { name: "More…" });
    fireEvent.click(more);
    await waitFor(() => expect(more).toBeDisabled());
    (more as HTMLButtonElement).disabled = false;
    fireEvent.click(more);
    expect(mockRandom).toHaveBeenCalledTimes(2);
    rejectMore(new Error("more failed"));
    expect(await screen.findByText("Couldn't load random photos right now.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More…" }));
    expect(await screen.findByRole("button", { name: "Similar retry-0" })).toBeTruthy();
  });

  it("keeps the recent load-more row visible while an oversized page refreshes", async () => {
    let resolveNext!: (value: any[]) => void;
    mockRecent
      .mockResolvedValueOnce(rows("oversized", 40) as any)
      .mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)) as any);
    render(<EmptyStateExplore database={database} onStartSimilarSearch={jest.fn()} />);
    const more = await screen.findByRole("button", { name: "More…" });
    fireEvent.click(more);
    expect(await screen.findByRole("button", { name: "Loading…" })).toBeTruthy();
    await act(async () => {
      resolveNext([]);
      await Promise.resolve();
    });
  });

  it("ignores async completions after unmount", async () => {
    let rejectMemory!: (reason: Error) => void;
    let rejectRecent!: (reason: Error) => void;
    let rejectRandom!: (reason: Error) => void;
    mockMemory.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectMemory = reject;
      }) as any,
    );
    mockRecent.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRecent = reject;
      }) as any,
    );
    mockRandom.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRandom = reject;
      }) as any,
    );
    const { unmount } = render(
      <EmptyStateExplore database={database} onStartSimilarSearch={jest.fn()} />,
    );
    unmount();

    await act(async () => {
      rejectMemory(new Error("late memory"));
      rejectRecent(new Error("late recent"));
      rejectRandom(new Error("late random"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("ignores successful async completions after unmount", async () => {
    let resolveMemory!: (value: any[]) => void;
    let resolveRecent!: (value: any[]) => void;
    let resolveRandom!: (value: any[]) => void;
    mockMemory.mockReturnValueOnce(new Promise((resolve) => (resolveMemory = resolve)) as any);
    mockRecent.mockReturnValueOnce(new Promise((resolve) => (resolveRecent = resolve)) as any);
    mockRandom.mockReturnValueOnce(new Promise((resolve) => (resolveRandom = resolve)) as any);
    const { unmount } = render(
      <EmptyStateExplore database={database} onStartSimilarSearch={jest.fn()} />,
    );
    unmount();

    await act(async () => {
      resolveMemory([]);
      resolveRecent([]);
      resolveRandom([]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
