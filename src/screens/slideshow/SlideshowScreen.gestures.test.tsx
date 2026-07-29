/**
 * @jest-environment jsdom
 */

// Screen-level wiring tests for the slideshow's touch niceties: hold-to-pause,
// the tap acknowledgement dip, and the follow-the-finger drag. The pure
// decision cores (util/slideshowGesture) are unit-tested separately; these
// cover the call-site wiring — timers, cadence pause plumbing, and the
// layer-keyed drag/ack state — that pure-helper tests cannot see.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { HOLD_TO_PAUSE_MS } from "../../util/slideshowGesture";

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

const row = (path: string) => ({ path, exif: "", geocode: "", colors: "" });
const poolA = row("../albums/test-simple/a.jpg");
const poolB = row("../albums/test-simple/b.jpg");
const poolC = row("../albums/test-simple/c.jpg");
const pool = [poolA, poolB, poolC];

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
  useLocalStorage: <T,>(_key: string, initialValue: T) => {
    const React = jest.requireActual<typeof import("react")>("react");
    const [value, setValue] = React.useState(initialValue);
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

const pointer = (
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  values: Record<string, unknown>,
) => {
  const event = new Event(type, { bubbles: true });
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(event, key, { value });
  }
  fireEvent(element, event);
};

const touchAt = (clientX: number, clientY: number) => ({
  pointerId: 1,
  pointerType: "touch",
  clientX,
  clientY,
  button: 0,
});

const slideImage = (): HTMLImageElement => screen.getByRole("img");

describe("SlideshowScreen touch gestures (screen-level)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    // Deterministic pool draws, and above REMIX_PROBABILITY so the top layer
    // is always a plain image (the gestures under test target the top layer
    // either way; the plain-image path is the one asserted here).
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    mockUseDatabase.mockReturnValue([readyDatabase, 100, null, null, mockRefreshDatabase]);
    mockUseEmbeddingsDatabase.mockReturnValue([
      readyEmbeddings,
      100,
      undefined,
      null,
      mockRetryEmbeddings,
    ]);
    mockFetchSlideshowPhotos.mockResolvedValue(pool);
    mockFetchSemanticResults.mockResolvedValue({ data: [row(poolB.path)] });
    mockFetchSimilarResults.mockResolvedValue({ data: [row(poolB.path)] });
    mockFetchRandomPhoto.mockResolvedValue([poolA]);
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
    window.history.replaceState(window.history.state, "", "/slideshow");
    global.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => "" }) as jest.Mock;
    Element.prototype.setPointerCapture = jest.fn();
    Element.prototype.releasePointerCapture = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => true);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it("pauses the cadence while a touch rests and resumes on release, without navigating", async () => {
    render(<SlideshowScreen />);
    await flush();
    jest.useFakeTimers();

    const image = slideImage();
    const initialSrc = image.getAttribute("src");
    pointer(image, "pointerdown", touchAt(300, 300));

    await act(async () => {
      jest.advanceTimersByTime(HOLD_TO_PAUSE_MS + 20);
    });
    expect(mockSetPaused).toHaveBeenCalledWith(true);
    expect(document.querySelector('[data-touch-hold="true"]')).not.toBeNull();

    pointer(image, "pointerup", touchAt(300, 300));
    await flush();
    expect(mockSetPaused).toHaveBeenLastCalledWith(false);
    expect(document.querySelector('[data-touch-hold="true"]')).toBeNull();
    // A held release must not navigate: the slide is unchanged.
    expect(slideImage().getAttribute("src")).toBe(initialSrc);
  });

  it("does not become a hold once the finger drifts into a swipe", async () => {
    render(<SlideshowScreen />);
    await flush();
    jest.useFakeTimers();

    const image = slideImage();
    pointer(image, "pointerdown", touchAt(300, 300));
    pointer(image, "pointermove", touchAt(260, 300));

    await act(async () => {
      jest.advanceTimersByTime(HOLD_TO_PAUSE_MS + 20);
    });
    expect(mockSetPaused).not.toHaveBeenCalled();
  });

  it("acknowledges a tap on the tapped layer immediately", async () => {
    render(<SlideshowScreen />);
    await flush();

    const image = slideImage();
    pointer(image, "pointerdown", touchAt(300, 300));
    pointer(image, "pointerup", touchAt(300, 300));

    expect(document.querySelector('[data-tap-ack="true"]')).not.toBeNull();
  });

  it("drags the top layer with a committed horizontal swipe and settles it on release", async () => {
    render(<SlideshowScreen />);
    await flush();

    const image = slideImage();
    pointer(image, "pointerdown", touchAt(300, 300));
    pointer(image, "pointermove", touchAt(240, 300));
    expect(image.style.transform).toBe("translateX(-60px)");

    pointer(image, "pointerup", touchAt(240, 300));
    await flush();
    // The dragged layer glides off-screen under the incoming fade.
    expect(image.className).toContain("layerSettling");
    const settled = /translateX\((-?[\d.]+)px\)/.exec(image.style.transform);
    expect(settled).not.toBeNull();
    expect(Number(settled![1])).toBeLessThan(-200);
  });
});
