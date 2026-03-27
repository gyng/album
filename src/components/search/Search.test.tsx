import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Search from "./Search";
import {
  fetchRandomPhoto,
  fetchRandomResults,
  fetchRecentResults,
  fetchRefinementTagCounts,
  fetchResults,
  fetchSimilarResults,
  fetchTags,
} from "./api";

const mockPush = jest.fn();
const mockUseDatabase = jest.fn();
const mockUseInfiniteQuery = jest.fn();

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
}));

jest.mock("@tanstack/react-query", () => ({
  keepPreviousData: Symbol("keepPreviousData"),
  useInfiniteQuery: (...args: unknown[]) => mockUseInfiniteQuery(...args),
}));

jest.mock("./api", () => ({
  fetchRandomPhoto: jest.fn(),
  fetchRandomResults: jest.fn(),
  fetchRecentResults: jest.fn(),
  fetchRefinementTagCounts: jest.fn(),
  fetchResults: jest.fn(),
  fetchSimilarResults: jest.fn(),
  fetchTags: jest.fn(),
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
  critique: "",
  suggested_title: "",
  composition_critique: "",
  subject: "",
  snippet: "Example shot",
  ...overrides,
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

  mockUseDatabase.mockReturnValue([mockDatabase, 42]);
  mockUseInfiniteQuery.mockImplementation((opts: any) => {
    const similarPath = opts?.queryKey?.[1]?.similarPath;
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

    return {
      data: {
        pages: [
          {
            data: similarPath ? similarResults : [],
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
  (fetchRefinementTagCounts as jest.Mock).mockResolvedValue({});
  (fetchResults as jest.Mock).mockResolvedValue({
    data: [],
    prev: undefined,
    next: undefined,
  });
  (fetchSimilarResults as jest.Mock).mockResolvedValue({
    data: [],
    prev: undefined,
    next: undefined,
  });
});

describe("Search", () => {
  it("renders the browse-mode sections and loading progress", async () => {
    render(<Search />);

    await waitFor(() => {
      expect(fetchTags).toHaveBeenCalledWith({
        database: mockDatabase,
        page: 0,
        pageSize: 1000,
        minCount: 1,
      });
    });

    expect(screen.getByText("Recent additions")).toBeTruthy();
    expect(screen.getByText("Random selection")).toBeTruthy();
    expect(
      screen.getByText(/keep stacking keywords to narrow results/i),
    ).toBeTruthy();
    expect(screen.getByText(/Loading/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /harbor/i })).toBeTruthy();
    expect(await screen.findByAltText("Recent shot")).toBeTruthy();
    expect(await screen.findByAltText("Random shot")).toBeTruthy();
  });

  it("switches from browse mode into similarity mode and back", async () => {
    render(<Search />);

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
    render(<Search />);

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

  it("switches into refinement mode when a browse tag is clicked", async () => {
    render(<Search />);

    fireEvent.click(await screen.findByRole("button", { name: /harbor/i }));

    await waitFor(() => {
      expect(fetchRefinementTagCounts).toHaveBeenCalledWith({
        database: mockDatabase,
        activeTerms: ["harbor"],
        candidateTags: ["harbor", "night"],
      });
    });

    expect(screen.queryByText("Recent additions")).toBeNull();
    expect(screen.queryByText("Random selection")).toBeNull();
  });
});
