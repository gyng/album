/**
 * @jest-environment jsdom
 */

// Screen-level tests for a clip slide: a clip must never cost the show its
// slide. Whatever goes wrong with the moving picture — a codec the browser
// cannot play, no network, a first frame that never comes, an autoplay the
// browser refuses — the slide falls back to the poster frame the clip started
// from, rather than being skipped.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

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
// The cadence's paused flag, per test.
let mockPaused = false;
// Media queries that match, per test.
let mockMatchingQueries: string[] = [];

const row = (path: string, mediaKind?: string, durationSeconds?: number) => ({
  path,
  exif: "",
  geocode: "",
  colors: "",
  ...(mediaKind ? { mediaKind } : {}),
  ...(durationSeconds ? { durationSeconds } : {}),
});
const clip = row("../albums/test-simple/clip.MOV", "video", 42);
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
    isPaused: mockPaused,
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
  replaceLocation: jest.fn(),
}));

const SlideshowScreen = require("./SlideshowScreen").default;
const mockReplaceLocation = jest.requireMock("../../util/navigate").replaceLocation as jest.Mock;

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
    mockPaused = false;
    mockMatchingQueries = [];
    window.localStorage.clear();
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
      value: jest.fn().mockImplementation((query: string) => ({
        matches: mockMatchingQueries.includes(query),
        media: query,
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

  // An installed app that lands on the unmanaged route would reload its whole
  // document for a new build and lose the wake lock; it belongs in the shell.
  it("moves into the shell when opened top-level in an installed app", async () => {
    mockReplaceLocation.mockClear();
    await startOn(still);
    expect(mockReplaceLocation).not.toHaveBeenCalled();
    cleanup();

    mockMatchingQueries.push("(display-mode: standalone)");
    try {
      await startOn(still);
      expect(mockReplaceLocation).toHaveBeenCalledWith(
        expect.stringMatching(/^\/slideshow\/shell(\?|$)/),
      );
    } finally {
      mockMatchingQueries.splice(mockMatchingQueries.indexOf("(display-mode: standalone)"), 1);
    }
  });

  it("plays a clip as a video", async () => {
    await startOn(clip);
    expect(slide()?.tagName).toBe("VIDEO");
  });

  it("loops a clip by default", async () => {
    await startOn(clip);
    expect((slide() as HTMLVideoElement).loop).toBe(true);
  });

  // With looping off, a clip plays once and settles back to its poster, the
  // frame chosen to stand for it, without costing the slide.
  it("plays a clip once when looping is off, then settles back to its poster", async () => {
    mockStored.set("slideshow-loop", false);
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
    mockStored.set("slideshow-loop", false);
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

  // iOS fetches nothing for a clip until it is asked to play, and a paused or
  // hidden slideshow does not ask. The first-frame deadline ran anyway and
  // retired the clip to a still for the rest of the session.
  it("does not give up on a clip that is waiting because the show is paused", async () => {
    jest.useFakeTimers();
    mockPaused = true;
    await startOn(clip);
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    await flush();
    expect(slide()?.tagName).toBe("VIDEO");
  });

  it("does not give up on a clip while the document is hidden, and does once it is seen", async () => {
    jest.useFakeTimers();
    const visibility = jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await startOn(clip);
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    await flush();
    expect(slide()?.tagName).toBe("VIDEO");

    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      jest.advanceTimersByTime(6100);
    });
    await flush();
    expect(slide()?.tagName).toBe("IMG");
  });

  // The forced mute was written to the element and nowhere else, so nothing
  // ever took it off again: the setting said sound, the clip stayed silent.
  it("brings the sound back on the next gesture after a refused unmuted autoplay", async () => {
    mockStored.set("slideshow-muted", false);
    let allowSound = false;
    play.mockImplementation(function (this: HTMLMediaElement) {
      return this.muted || allowSound
        ? Promise.resolve()
        : Promise.reject(Object.assign(new Error("refused"), { name: "NotAllowedError" }));
    });
    await startOn(clip);
    const video = slide() as HTMLVideoElement;
    await flush();
    expect(video.muted).toBe(true);
    // The chip reports what is heard, not what the setting hoped for.
    expect(screen.getByRole("button", { name: "Mute clip" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    allowSound = true;
    await act(async () => {
      window.dispatchEvent(new Event("pointerup"));
    });
    await flush();

    expect(video.muted).toBe(false);
    expect(screen.getByRole("button", { name: "Mute clip" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks a clip slide with a chip that toggles the sound without advancing", async () => {
    await startOn(clip);
    const chip = screen.getByRole("button", { name: "Mute clip" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip.textContent).toBe("0:42");
    const fetchesBefore = mockFetchRandomPhoto.mock.calls.length;

    fireEvent.pointerDown(chip);
    fireEvent.pointerUp(chip);
    fireEvent.click(chip);
    await flush();

    expect((slide() as HTMLVideoElement).muted).toBe(false);
    expect(screen.getByRole("button", { name: "Mute clip" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(slide()?.getAttribute("poster")).toMatch(/clip/);
    expect(mockFetchRandomPhoto.mock.calls.length).toBe(fetchesBefore);
  });

  it("shows no clip chip on a photograph", async () => {
    await startOn(still);
    expect(screen.queryByRole("button", { name: "Mute clip" })).toBeNull();
  });

  it("toggles mute on M and loop on L", async () => {
    await startOn(clip);
    expect((slide() as HTMLVideoElement).muted).toBe(true);
    expect((slide() as HTMLVideoElement).loop).toBe(true);

    fireEvent.keyDown(window, { key: "m" });
    fireEvent.keyDown(window, { key: "l" });
    await flush();

    expect((slide() as HTMLVideoElement).muted).toBe(false);
    expect((slide() as HTMLVideoElement).loop).toBe(false);
  });

  // One Wi-Fi blip on a kiosk retired every clip it touched until the next
  // reload, which can be weeks away.
  it("gives a failed clip another chance when the connection comes back", async () => {
    await startOn(clip);
    fireEvent.error(slide()!);
    await flush();
    expect(slide()?.tagName).toBe("IMG");

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flush();

    expect(slide()?.tagName).toBe("VIDEO");
  });

  it("shows a clip as its still under reduced motion", async () => {
    mockMatchingQueries = ["(prefers-reduced-motion: reduce)"];
    await startOn(clip);
    expect(slide()?.tagName).toBe("IMG");
    expect(screen.queryByRole("button", { name: "Mute clip" })).toBeNull();
  });

  // A setting given in the URL is applied once. Left in the address, a copied
  // link's `muted=0` came back on every reload and undid the toolbar.
  it("takes applied settings out of the live URL and keeps the state the URL owns", async () => {
    window.history.replaceState(
      window.history.state,
      "",
      "/slideshow?remix=0&muted=0&loop=0&volume=0.25&clock=1&filter=test-simple",
    );
    await startOn(clip);

    expect((slide() as HTMLVideoElement).loop).toBe(false);
    const params = new URLSearchParams(window.location.search);
    for (const name of ["remix", "muted", "loop", "volume", "clock"]) {
      expect(params.has(name)).toBe(false);
    }
    expect(params.get("filter")).toBe("test-simple");
  });

  it("does not offer the volume where the browser will not take one", async () => {
    const volume = jest.spyOn(HTMLMediaElement.prototype, "volume", "get").mockReturnValue(1);
    jest.spyOn(HTMLMediaElement.prototype, "volume", "set").mockImplementation(() => {});
    await startOn(clip);
    expect(screen.queryByRole("slider", { name: "Clip volume" })).toBeNull();
    expect(volume).toHaveBeenCalled();
  });

  describe("a remix grid", () => {
    const third = row("../albums/test-simple/c.jpg");
    const grid = () => document.querySelector(".remixGrid") as HTMLElement | null;
    const startGrid = async (seed: ReturnType<typeof row>) => {
      Object.defineProperty(HTMLImageElement.prototype, "decode", {
        configurable: true,
        value: () => Promise.resolve(),
      });
      mockFetchSlideshowPhotos.mockResolvedValue([still, third, seed]);
      mockFetchRandomPhoto.mockResolvedValue([still]);
      render(<SlideshowScreen />);
      await flush();
      mockFetchRandomPhoto.mockResolvedValue([seed]);
      fireEvent.click(screen.getByRole("button", { name: /Remix now/ }));
      await flush();
      await flush();
      expect(grid()).not.toBeNull();
      // The grid under test is the one this seed leads.
      expect(grid()!.querySelector("img")?.getAttribute("src")).toContain(
        seed.path.split("/").pop()!,
      );
      return Array.from(grid()!.querySelectorAll("img"));
    };
    afterEach(() => {
      delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
    });

    // One 404 among the companions used to keep the grid from ever showing:
    // the cell was marked loaded but never decoded, and the slide was skipped.
    it("shows with a broken companion instead of being skipped", async () => {
      jest.useFakeTimers();
      const [seedImage, ...companions] = await startGrid(row("../albums/test-simple/d.jpg"));
      expect(companions.length).toBeGreaterThan(0);
      const fetchesBefore = mockFetchRandomPhoto.mock.calls.length;

      fireEvent.load(seedImage!);
      for (const companion of companions) fireEvent.error(companion);
      await flush();
      await act(async () => {
        jest.advanceTimersByTime(7000);
      });
      await flush();

      expect(grid()).not.toBeNull();
      expect(grid()!.className).not.toMatch(/layerHidden/);
      expect(mockFetchRandomPhoto.mock.calls.length).toBe(fetchesBefore);
    });

    // The grid is stills by design, so a slow one says nothing about the clip.
    it("passes over a slow grid seeded by a clip instead of blaming the clip", async () => {
      jest.useFakeTimers();
      await startGrid(clip);
      await act(async () => {
        jest.advanceTimersByTime(6100);
      });
      await flush();

      await flush();

      // Passed over like any slow slide. Blamed on the clip, the grid stayed
      // where it was, hidden, and the clip was a still from then on.
      expect(grid()).toBeNull();
    });
  });
});
