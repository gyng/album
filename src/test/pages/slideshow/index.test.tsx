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
const mockClipboardWriteText = jest.fn();
const samplePhoto = {
  path: "../albums/test-simple/DSCF0506.jpg",
  exif: "",
  geocode: "",
};

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
        clipboard: {
          writeText: mockClipboardWriteText,
        },
      },
    });
    window.history.replaceState(window.history.state, "", "/slideshow");
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      text: async () => "",
    }) as jest.Mock;
    Element.prototype.setPointerCapture = jest.fn();
    Element.prototype.releasePointerCapture = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => true);
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

  it("requests a screen wake lock while the slideshow is mounted", async () => {
    const wakeLockSentinel = Object.assign(new EventTarget(), {
      release: jest.fn().mockResolvedValue(undefined),
    });
    const requestWakeLock = jest.fn().mockResolvedValue(wakeLockSentinel);
    Object.defineProperty(window, "navigator", {
      configurable: true,
      value: {
        onLine: true,
        wakeLock: {
          request: requestWakeLock,
        },
      },
    });

    const { unmount } = render(<SlideshowPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(requestWakeLock).toHaveBeenCalledWith("screen");

    unmount();

    expect(wakeLockSentinel.release).toHaveBeenCalledTimes(1);
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

  it("resolves an initial photo parameter without keeping it in the URL", async () => {
    mockUseDatabase.mockReturnValue([{ db: true }, 100]);
    mockFetchSlideshowPhotos.mockResolvedValue([samplePhoto]);
    window.history.replaceState(
      window.history.state,
      "",
      `/slideshow?mode=random&filter=test-simple&delay=60&photo=${encodeURIComponent(
        samplePhoto.path,
      )}`,
    );

    render(<SlideshowPage />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("img", { name: /DSCF0506/ }).getAttribute("src")).toBe(
      "/data/albums/test-simple/.resized_images/DSCF0506.jpg@3200.avif",
    );

    const url = new URL(window.location.href);
    expect(url.searchParams.get("mode")).toBe("weighted");
    expect(url.searchParams.get("filter")).toBe("test-simple");
    expect(url.searchParams.get("delay")).toBe("60");
    expect(url.searchParams.has("photo")).toBe(false);
    expect(url.searchParams.has("seed")).toBe(false);
  });

  it("writes timing changes into the URL", async () => {
    mockUseDatabase.mockReturnValue([{ db: true }, 100]);
    mockFetchSlideshowPhotos.mockResolvedValue([samplePhoto]);

    render(<SlideshowPage />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    screen.getByRole("button", { name: "1m" }).click();

    const url = new URL(window.location.href);
    expect(url.searchParams.get("mode")).toBe("weighted");
    expect(url.searchParams.get("delay")).toBe("60");
  });

  it("copies a current-photo slideshow link from the context section", async () => {
    mockUseDatabase.mockReturnValue([{ db: true }, 100]);
    mockFetchSlideshowPhotos.mockResolvedValue([samplePhoto]);

    render(<SlideshowPage />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    screen.getByRole("button", { name: "copy photo link" }).click();

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
    const copiedUrl = new URL(mockClipboardWriteText.mock.calls[0][0]);
    expect(copiedUrl.pathname).toBe("/slideshow");
    expect(copiedUrl.searchParams.get("mode")).toBe("weighted");
    expect(copiedUrl.searchParams.get("photo")).toBe(samplePhoto.path);
  });

});
