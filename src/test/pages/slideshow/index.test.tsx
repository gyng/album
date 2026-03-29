/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { act } from "react";

const mockUseDatabase = jest.fn();
const mockUseEmbeddingsDatabase = jest.fn();
const mockFetchSlideshowPhotos = jest.fn();
const mockReloadCurrentPage = jest.fn();
const mockBuildVersion = "test-build-version";

jest.mock("../../../components/database/useDatabase", () => ({
  useDatabase: () => mockUseDatabase(),
  useEmbeddingsDatabase: () => mockUseEmbeddingsDatabase(),
}));

jest.mock("../../../components/search/api", () => ({
  fetchSlideshowPhotos: (...args: unknown[]) => mockFetchSlideshowPhotos(...args),
  fetchSimilarResults: jest.fn(),
}));

jest.mock("../../../components/ProgressBar", () => ({
  ProgressBar: ({ progress }: { progress: number }) => (
    <div>Loading... {progress}%</div>
  ),
}));

jest.mock("../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <div>Theme toggle</div>,
}));

jest.mock("../../../components/Map", () => () => null);

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("usehooks-ts", () => ({
  useLocalStorage: (_key: string, initialValue: unknown) => [
    initialValue,
    jest.fn(),
    jest.fn(),
  ],
}));

jest.mock("../../../lib/buildVersion", () => ({
  BUILD_VERSION: "test-build-version",
}));

jest.mock("../../../util/navigate", () => ({
  navigateTo: jest.fn(),
  reloadCurrentPage: () => mockReloadCurrentPage(),
}));

const SlideshowPage =
  require("../../../pages/slideshow/index").default;

describe("slideshow page", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockUseDatabase.mockReturnValue([null, 42]);
    mockUseEmbeddingsDatabase.mockReturnValue([null, 0]);
    mockFetchSlideshowPhotos.mockResolvedValue([]);
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
    Object.defineProperty(window, "navigator", {
      configurable: true,
      value: {
        onLine: true,
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      text: async () => "",
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it("renders loading progress while the database is unavailable", () => {
    render(<SlideshowPage />);

    expect(screen.getByText("Loading... 42%")).toBeTruthy();
  });

  it("polls the owned version manifest and reloads when the build version changes", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        buildVersion: "new-build-version",
      }),
    });

    render(<SlideshowPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith("/version.json", {
      cache: "no-store",
    });
    expect(mockReloadCurrentPage).toHaveBeenCalledTimes(1);
  });

  it("does not reload when the manifest build version matches the current build", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        buildVersion: mockBuildVersion,
      }),
    });

    render(<SlideshowPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockReloadCurrentPage).not.toHaveBeenCalled();
  });

  it("polls again on the update interval", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        buildVersion: mockBuildVersion,
      }),
    });

    render(<SlideshowPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(300000);
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockReloadCurrentPage).not.toHaveBeenCalled();
  });
});
