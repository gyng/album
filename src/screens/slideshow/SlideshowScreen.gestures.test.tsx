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
const Slideshow = require("./SlideshowScreen").Slideshow;

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

const finishTransition = (element: Element, propertyName: string) => {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  fireEvent(element, event);
};

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

  it("does not report readiness until a real image decode and reveal complete", async () => {
    jest.useFakeTimers();
    const post = jest.spyOn(window.parent, "postMessage");
    render(<Slideshow managedCodeReload />);
    await flush();
    expect(post.mock.calls.some(([message]) => message.presentation)).toBe(false);
    const image = slideImage();
    // CSS Modules are mocked in jsdom; supply the completed reveal at the
    // browser boundary. The E2E handover checks the real animated image.
    image.style.opacity = "1";
    Object.defineProperty(image, "decode", { value: jest.fn().mockResolvedValue(undefined) });
    fireEvent.load(image);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(
      post.mock.calls.some(([message]) =>
        message.presentation?.sources.includes(image.getAttribute("src")),
      ),
    ).toBe(true);
    post.mockRestore();
  });

  it("keeps the last decoded layer when its replacement hangs past the image deadline", async () => {
    jest.useFakeTimers();
    render(<SlideshowScreen />);
    await flush();
    const image = slideImage();
    Object.defineProperty(image, "decode", { value: jest.fn().mockResolvedValue(undefined) });
    fireEvent.load(image);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    fireEvent.click(image);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(6100);
    });
    const fadeEnd = new Event("transitionend", { bubbles: true });
    Object.defineProperty(fadeEnd, "propertyName", { value: "opacity" });
    fireEvent(image, fadeEnd);
    expect(image).toBeInTheDocument();
  });

  it("presents a reused image when backtracking without waiting for a second load event", async () => {
    jest.useFakeTimers();
    const post = jest.spyOn(window.parent, "postMessage");
    render(<Slideshow managedCodeReload />);
    await flush();
    const image = slideImage();
    image.style.opacity = "1";
    Object.defineProperties(image, {
      decode: { value: jest.fn().mockResolvedValue(undefined) },
      complete: { value: true },
      naturalWidth: { value: 800 },
    });
    fireEvent.load(image);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    fireEvent.click(image);
    await flush();
    expect(slideImage()).not.toBe(image);
    post.mockClear();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await flush();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(slideImage()).toBe(image);
    expect(
      post.mock.calls.some(([message]) =>
        message.presentation?.sources.includes(image.getAttribute("src")),
      ),
    ).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6100);
    });
    expect(slideImage()).toBe(image);
    post.mockRestore();
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

  // The press used to be a dip fired *after* release, on its own clock: a slow
  // press got no answer at all, and a quick one got an answer that had already
  // finished. It is the contact now — down on touch, held while held, back on
  // release, which is also when the next photograph starts loading.
  it("presses the photograph in on contact and lets it go on release", async () => {
    render(<SlideshowScreen />);
    await flush();

    const pressed = () => document.querySelector('[data-pressed="true"]');
    const image = slideImage();
    expect(pressed()).toBeNull();

    pointer(image, "pointerdown", touchAt(300, 300));
    expect(pressed()).toBe(image);

    pointer(image, "pointerup", touchAt(300, 300));
    expect(pressed()).toBeNull();
  });

  // A gesture the browser takes away (a system swipe, a call) must not leave the
  // photograph pushed in for the rest of the session.
  it("lets go when the gesture is cancelled rather than released", async () => {
    render(<SlideshowScreen />);
    await flush();

    const image = slideImage();
    pointer(image, "pointerdown", touchAt(300, 300));
    expect(document.querySelector('[data-pressed="true"]')).not.toBeNull();

    pointer(image, "pointercancel", touchAt(300, 300));
    expect(document.querySelector('[data-pressed="true"]')).toBeNull();
  });

  // Dragging the slide aside used to reveal the page behind it — a black void
  // the width of the gesture — rather than where the swipe was going.
  it("reveals the neighbour progressively and fades it away as the swipe settles", async () => {
    render(<SlideshowScreen />);
    await flush();

    const peek = () => document.querySelector("[data-drag-peek]") as HTMLImageElement | null;
    expect(peek()).toBeNull();

    const image = slideImage();
    pointer(image, "pointerdown", touchAt(300, 300));
    pointer(image, "pointermove", touchAt(240, 300));

    const uncovered = peek();
    expect(uncovered).not.toBeNull();
    // The buffered next photograph, not the one on screen.
    expect(uncovered!.getAttribute("src")).not.toBe(image.getAttribute("src"));
    // It comes up with the gesture rather than appearing at full strength.
    const earlyProgress = Number(uncovered!.style.getPropertyValue("--drag-peek-progress"));
    expect(earlyProgress).toBeGreaterThan(0);
    expect(earlyProgress).toBeLessThan(0.5);
    pointer(image, "pointermove", touchAt(180, 300));
    expect(Number(peek()!.style.getPropertyValue("--drag-peek-progress"))).toBeGreaterThan(
      earlyProgress,
    );

    // Release fades the existing preview out instead of removing it mid-drag.
    pointer(image, "pointerup", touchAt(180, 300));
    await flush();
    expect(peek()).toBe(uncovered);
    expect(peek()).toHaveAttribute("data-settling", "true");
  });

  it("springs back when the browser cancels a swipe", async () => {
    render(<SlideshowScreen />);
    await flush();
    const image = slideImage();
    const src = image.getAttribute("src");
    pointer(image, "pointerdown", touchAt(300, 300));
    pointer(image, "pointermove", touchAt(200, 300));
    pointer(image, "pointercancel", touchAt(200, 300));
    expect(image.style.transform).toBe("translateX(0px)");
    expect(slideImage().getAttribute("src")).toBe(src);
    const settled = new Event("transitionend", { bubbles: true });
    Object.defineProperty(settled, "propertyName", { value: "transform" });
    fireEvent(image, settled);
    expect(document.querySelector("[data-drag-peek]")).toBeNull();
    expect(image.style.transform).toBe("");
  });

  it("reuses both neighbour images through centre crossings and a cancelled re-drag", async () => {
    render(<SlideshowScreen />);
    await flush();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await flush();
    const image = slideImage();
    const src = image.getAttribute("src");
    const buffers = Array.from(document.querySelectorAll<HTMLImageElement>("[data-drag-buffer]"));
    expect(buffers).toHaveLength(2);
    const sources = buffers.map((buffer) => buffer.getAttribute("src"));

    const dragBothWays = () => {
      pointer(image, "pointerdown", touchAt(300, 300));
      for (const x of [292, 299, 296, 288, 277, 300, 304, 312, 323, 360, 300, 320]) {
        pointer(image, "pointermove", touchAt(x, 300));
        expect(image.style.transform).toBe(`translateX(${x - 300}px)`);
        expect(Array.from(document.querySelectorAll("[data-drag-buffer]"))).toEqual(buffers);
        expect(buffers.map((buffer) => buffer.getAttribute("src"))).toEqual(sources);
      }
      pointer(image, "pointercancel", touchAt(320, 300));
    };
    dragBothWays();
    // Interrupt the spring-back too: a second contact must not discard buffers.
    dragBothWays();
    expect(slideImage().getAttribute("src")).toBe(src);
    pointer(image, "pointerdown", touchAt(300, 300));
    pointer(image, "pointermove", touchAt(240, 300));
    pointer(image, "pointermove", touchAt(300, 300));
    pointer(image, "pointercancel", touchAt(300, 300));
    // At rest there is no transform transition to deliver a cleanup event.
    expect(document.querySelector("[data-drag-peek]")).toBeNull();
  });

  it("lets a small horizontal start become a vertical gesture", async () => {
    render(<SlideshowScreen />);
    await flush();
    const image = slideImage();
    const src = image.getAttribute("src");
    pointer(image, "pointerdown", touchAt(300, 300));
    pointer(image, "pointermove", touchAt(308, 300));
    expect(image.style.transform).toBe("translateX(8px)");
    pointer(image, "pointermove", touchAt(308, 250));
    expect(image.style.transform).toBe("");
    pointer(image, "pointercancel", touchAt(308, 250));
    expect(slideImage().getAttribute("src")).toBe(src);
  });

  it("keeps tap wobble still without a drag preview or exit glide", async () => {
    render(<SlideshowScreen />);
    await flush();
    const image = slideImage();
    const src = image.getAttribute("src");
    pointer(image, "pointerdown", touchAt(300, 300));
    for (const x of [301, 304, 307, 300, 299, 296, 293, 304]) {
      pointer(image, "pointermove", touchAt(x, 300));
      expect(image.style.transform).toBe("");
      expect(document.querySelector("[data-drag-peek]")).toBeNull();
    }
    pointer(image, "pointerup", touchAt(304, 300));
    await flush();
    expect(slideImage().getAttribute("src")).not.toBe(src);
    expect(image.style.transform).toBe("");
  });

  it("rearms wobble protection on a new contact after cancelling a drag", async () => {
    render(<SlideshowScreen />);
    await flush();
    const image = slideImage();
    pointer(image, "pointerdown", touchAt(300, 300));
    pointer(image, "pointermove", touchAt(308, 300));
    pointer(image, "pointermove", touchAt(304, 300));
    expect(image.style.transform).toBe("translateX(4px)");
    pointer(image, "pointercancel", touchAt(304, 300));
    pointer(image, "pointerdown", touchAt(300, 300));
    pointer(image, "pointermove", touchAt(304, 300));
    expect(image.style.transform).toBe("");
    pointer(image, "pointercancel", touchAt(304, 300));
  });

  it("settles an active drag released back inside the wobble tolerance", async () => {
    render(<SlideshowScreen />);
    await flush();
    const image = slideImage();
    pointer(image, "pointerdown", touchAt(300, 300));
    pointer(image, "pointermove", touchAt(308, 300));
    pointer(image, "pointermove", touchAt(304, 300));
    expect(image.style.transform).toBe("translateX(4px)");
    pointer(image, "pointerup", touchAt(304, 300));
    expect(image.style.transform).toBe("translateX(0px)");
  });

  it("keeps the first photograph in place when there is no previous slide", async () => {
    render(<SlideshowScreen />);
    await flush();
    const image = slideImage();
    const src = image.getAttribute("src");
    pointer(image, "pointerdown", touchAt(300, 300));
    pointer(image, "pointermove", touchAt(400, 300));
    pointer(image, "pointerup", touchAt(400, 300));
    await flush();
    expect(slideImage().getAttribute("src")).toBe(src);
    expect(image.style.transform).toBe("translateX(0px)");
  });

  it.each(["exit finishes", "next contact starts"])(
    "keeps the outgoing photo displaced when the %s before its fade ends",
    async (interruption) => {
      render(<SlideshowScreen />);
      await flush();
      const outgoing = slideImage();
      pointer(outgoing, "pointerdown", touchAt(300, 300));
      pointer(outgoing, "pointermove", touchAt(240, 300));
      pointer(outgoing, "pointerup", touchAt(240, 300));
      await flush();
      const exitTransform = outgoing.style.transform;
      expect(exitTransform).toMatch(/^translateX\(-/);
      const incoming = slideImage();
      expect(incoming).not.toBe(outgoing);
      expect(outgoing.isConnected).toBe(true);

      if (interruption === "exit finishes") {
        finishTransition(outgoing, "transform");
      } else {
        pointer(incoming, "pointerdown", touchAt(300, 300));
        pointer(incoming, "pointermove", touchAt(270, 300));
        expect(incoming.style.transform).toBe("translateX(-30px)");
      }
      expect(outgoing.style.transform).toBe(exitTransform);
      expect(outgoing.isConnected).toBe(true);
      finishTransition(outgoing, "opacity");
      expect(outgoing.isConnected).toBe(false);
    },
  );

  it("centres a previously exited photo when navigating back to it mid-fade", async () => {
    render(<SlideshowScreen />);
    await flush();
    const outgoing = slideImage();
    pointer(outgoing, "pointerdown", touchAt(300, 300));
    pointer(outgoing, "pointermove", touchAt(240, 300));
    pointer(outgoing, "pointerup", touchAt(240, 300));
    await flush();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await flush();
    expect(slideImage()).toBe(outgoing);
    expect(outgoing.style.transform).toBe("");
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
