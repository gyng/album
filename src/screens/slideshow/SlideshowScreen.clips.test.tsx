/**
 * @jest-environment jsdom
 */

// Screen-level tests for a clip slide: a clip must never cost the show its
// slide. Whatever goes wrong with the moving picture — a codec the browser
// cannot play, no network, a first frame that never comes, an autoplay the
// browser refuses — the slide falls back to the poster frame the clip started
// from, rather than being skipped.

import { act, fireEvent, render, screen } from "@testing-library/react";

const mockUseDatabase = jest.fn();
const mockUseEmbeddingsDatabase = jest.fn();
const mockFetchSlideshowPhotos = jest.fn();
const mockFetchSemanticResults = jest.fn();
const mockFetchSimilarResults = jest.fn();
const mockFetchRandomPhoto = jest.fn();
const mockEncodeSearchText = jest.fn();
const mockRefreshDatabase = jest.fn();
const mockRetryEmbeddings = jest.fn();
const mockSetPaused = jest.fn();

const row = (path: string, mediaKind?: string) => ({
  path,
  exif: "",
  geocode: "",
  colors: "",
  ...(mediaKind ? { mediaKind } : {}),
});
const clip = row("../albums/test-simple/clip.MOV", "video");
const external = row("../albums/test-simple/abc123.youtube", "video");
const still = row("../albums/test-simple/b.jpg");
// Stored settings the screen reads through useLocalStorage, per test.
const mockStored = new Map<string, unknown>();

jest.mock("../../components/database/useDatabase", () => ({
  SEARCH_DATABASE_URL: "/search.sqlite",
  useDatabase: () => mockUseDatabase(),
  useEmbeddingsDatabase: () => mockUseEmbeddingsDatabase(),
}));

jest.mock("../../components/search/api", () => ({
  fetchSlideshowPhotos: (...args: unknown[]) => mockFetchSlideshowPhotos(...args),
  fetchSemanticResults: (...args: unknown[]) => mockFetchSemanticResults(...args),
  fetchSimilarResults: (...args: unknown[]) => mockFetchSimilarResults(...args),
  fetchRandomPhoto: (...args: unknown[]) => mockFetchRandomPhoto(...args),
}));

jest.mock("../../components/search/textEmbeddings", () => ({
  encodeSearchText: (...args: unknown[]) => mockEncodeSearchText(...args),
}));

// Passive cadence stub that records pause plumbing calls.
jest.mock("../../components/useSlideshowCadence", () => ({
  useSlideshowCadence: () => ({
    secondsLeft: 0,
    time: null,
    isPaused: false,
    togglePaused: jest.fn(),
    setPaused: mockSetPaused,
    scheduleNextChange: jest.fn(),
    alignNextChangeToCadence: jest.fn(),
  }),
}));

jest.mock("../../components/ProgressBar", () => ({
  ProgressBar: ({ progress }: { progress: number }) => <div>Loading... {progress}%</div>,
}));

jest.mock("../../components/ThemeToggle", () => ({
  ThemeToggle: () => <div>Theme toggle</div>,
}));

jest.mock("../../components/Map", () => () => null);

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
  useLocalStorage: <T,>(key: string, initialValue: T) => {
    const React = jest.requireActual<typeof import("react")>("react");
    const [value, setValue] = React.useState<T>(
      mockStored.has(key) ? (mockStored.get(key) as T) : initialValue,
    );
    return [value, setValue, () => setValue(initialValue)] as const;
  },
}));

jest.mock("../../lib/buildVersion", () => ({
  BUILD_VERSION: "test-build-version",
  BUILD_METADATA: {
    buildVersion: "test-build-version",
    builtAt: "2026-07-20T09:00:00.000Z",
    gitSha: "test-build-version",
  },
}));

jest.mock("../../util/navigate", () => ({
  navigateTo: jest.fn(),
  reloadCurrentPage: jest.fn(),
}));

const SlideshowScreen = require("./SlideshowScreen").default;

const readyDatabase = { db: true };
const readyEmbeddings = { embeddings: true };

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const slide = () =>
  document.querySelector('[data-media-kind]:not([aria-hidden="true"])') as HTMLElement | null;

const startOn = async (first: ReturnType<typeof row>) => {
  mockFetchSlideshowPhotos.mockResolvedValue([first, still]);
  mockFetchRandomPhoto.mockResolvedValue([first]);
  render(<SlideshowScreen />);
  await flush();
};

describe("SlideshowScreen clip slides", () => {
  const originalFetch = global.fetch;
  let play: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStored.clear();
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    mockUseDatabase.mockReturnValue([readyDatabase, 100, null, null, mockRefreshDatabase]);
    mockUseEmbeddingsDatabase.mockReturnValue([
      readyEmbeddings,
      100,
      undefined,
      null,
      mockRetryEmbeddings,
    ]);
    mockFetchSemanticResults.mockResolvedValue({ data: [] });
    mockFetchSimilarResults.mockResolvedValue({ data: [] });
    mockEncodeSearchText.mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));
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
      value: { onLine: true, clipboard: { writeText: jest.fn() } },
    });
    window.history.replaceState(window.history.state, "", "/slideshow?remix=0");
    global.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => "" }) as jest.Mock;
    play = jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    jest.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("plays a clip as a video", async () => {
    await startOn(clip);
    expect(slide()?.tagName).toBe("VIDEO");
  });

  // A slide lasts minutes and a clip seconds: looped, a ten-second clip jumped
  // back to its start ninety times a slide. It plays once and settles back to
  // its poster, the frame chosen to stand for it, without costing the slide.
  it("plays a clip once, then settles back to its poster", async () => {
    await startOn(clip);
    const video = slide() as HTMLVideoElement;
    expect(video.loop).toBe(false);
    const poster = video.getAttribute("poster");
    const fetchesBefore = mockFetchRandomPhoto.mock.calls.length;

    fireEvent.ended(video);
    await flush();

    expect(slide()?.tagName).toBe("IMG");
    expect(slide()?.getAttribute("src")).toBe(poster);
    expect(mockFetchRandomPhoto.mock.calls.length).toBe(fetchesBefore);
  });

  // "Previous" back to a clip that has finished is asking to see it again.
  it("plays a finished clip again when the reader comes back to it", async () => {
    await startOn(clip);
    fireEvent.ended(slide()!);
    await flush();
    expect(slide()?.tagName).toBe("IMG");

    mockFetchRandomPhoto.mockResolvedValue([still]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await flush();
    await flush();
    expect(slide()?.getAttribute("src")).toMatch(/b\.jpg/);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await flush();
    await flush();

    expect(slide()?.tagName).toBe("VIDEO");
  });

  it("loops a clip when the reader has asked for it", async () => {
    mockStored.set("slideshow-loop", true);
    await startOn(clip);
    expect((slide() as HTMLVideoElement).loop).toBe(true);
  });

  // A clip the browser cannot play — a codec it lacks, no network for an
  // uncached MP4 — used to skip the slide and put the show into its outage
  // mode for fifteen seconds. The poster frame is the clip's own picture.
  it("falls back to the poster still when the clip fails, without skipping the slide", async () => {
    await startOn(clip);
    const video = slide()!;
    const poster = video.getAttribute("poster");
    const fetchesBefore = mockFetchRandomPhoto.mock.calls.length;

    fireEvent.error(video);
    await flush();

    expect(slide()?.tagName).toBe("IMG");
    expect(slide()?.getAttribute("src")).toBe(poster);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    // Still on the clip's picture: no skip was scheduled.
    expect(slide()?.getAttribute("src")).toBe(poster);
    expect(mockFetchRandomPhoto.mock.calls.length).toBe(fetchesBefore);
  });

  // A YouTube external is indexed as a video but has no transcoded MP4.
  it("never offers an external as a playable clip", async () => {
    await startOn(external);
    expect(slide()?.tagName).toBe("IMG");
  });

  // A reader who unmuted once has no gesture on the next launch, and the
  // browser refuses an unmuted autoplay: the clip sat on its first frame.
  it("retries a refused unmuted autoplay muted", async () => {
    mockStored.set("slideshow-muted", false);
    play.mockImplementation(function (this: HTMLMediaElement) {
      return this.muted
        ? Promise.resolve()
        : Promise.reject(Object.assign(new Error("refused"), { name: "NotAllowedError" }));
    });
    await startOn(clip);
    const video = slide() as HTMLVideoElement;
    Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
    fireEvent.loadedData(video);
    await flush();
    await flush();

    expect(video.muted).toBe(true);
    expect(play.mock.contexts.filter((context) => context === video).length).toBeGreaterThan(1);
  });

  // A first frame that never arrives — a slow kiosk connection, or a browser
  // that fetches nothing until asked to play — used to skip the slide.
  it("falls back to the poster still when the clip's first frame never comes", async () => {
    jest.useFakeTimers();
    await startOn(clip);
    const poster = slide()!.getAttribute("poster");
    await act(async () => {
      jest.advanceTimersByTime(6100);
    });
    await flush();
    expect(slide()?.tagName).toBe("IMG");
    expect(slide()?.getAttribute("src")).toBe(poster);
  });
});
