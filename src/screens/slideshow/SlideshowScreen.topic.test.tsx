/**
 * @jest-environment jsdom
 */

// Screen-level integration harness for SlideshowScreen's topical-seeding
// behaviour. The pure decision core in util/slideshowTopic is unit-tested
// separately; these tests cover the CALL-SITE wiring (effect triggers,
// provenance threading, error identity) that pure-helper tests cannot see. The
// DB hooks, the embedding encode, the semantic fetch, and the cadence hook are
// mocked at their module boundaries so the test can drive a topic submit and
// observe the committed chip / mode / URL.

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

// Capture the cadence hook's onAdvance so a test can fire an app-driven advance
// (the exact provenance path finding 2 is about) without real timers.
let cadenceOnAdvance: () => void = () => {};

const row = (path: string) => ({ path, exif: "", geocode: "", colors: "" });
const poolA = row("../albums/test-simple/a.jpg");
const poolB = row("../albums/test-simple/b.jpg");
const poolC = row("../albums/test-simple/c.jpg");
const pool = [poolA, poolB, poolC];

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

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

// Replace the cadence hook with a passive stub that hands us its onAdvance.
jest.mock("../../components/useSlideshowCadence", () => ({
  useSlideshowCadence: (input: { onAdvance: () => void }) => {
    cadenceOnAdvance = input.onAdvance;
    return {
      secondsLeft: 0,
      time: null,
      isPaused: false,
      togglePaused: jest.fn(),
      scheduleNextChange: jest.fn(),
      alignNextChangeToCadence: jest.fn(),
    };
  },
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
}));

jest.mock("../../util/navigate", () => ({
  navigateTo: jest.fn(),
  reloadCurrentPage: jest.fn(),
}));

const SlideshowScreen = require("./SlideshowScreen").default;

const readyDatabase = { db: true };
const readyEmbeddings = { embeddings: true };

// A couple of microtask turns flush the pool load / encode / fetch promise
// chains without real timers.
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const submitTopic = async (text: string) => {
  const input = screen.getByLabelText("Slideshow topic");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Seed" }));
  await Promise.resolve();
};

const chipVisible = () => screen.queryByRole("button", { name: "Clear topic" }) !== null;

describe("SlideshowScreen topic seeding (screen-level)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    cadenceOnAdvance = () => {};
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
  });

  // Submitting a topic while the mode is still weighted must not be cancelled by
  // the cross-tab safety-net effect during the busy (pre-success) window.
  it("commits a topic submitted from weighted mode: seed lands, mode becomes similar, chip appears", async () => {
    const encode = deferred<Float32Array>();
    mockEncodeSearchText.mockReturnValue(encode.promise);

    render(<SlideshowScreen />);
    await flush();

    // Baseline: weighted mode, no chip.
    expect(screen.getByRole("button", { name: /Recent/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(chipVisible()).toBe(false);

    await act(async () => {
      await submitTopic("cat");
    });
    // Mid-flight: the encode is still pending; the buggy effect would already
    // have dismissed the submission here.
    expect(screen.getByText("Seeding…")).toBeTruthy();

    await act(async () => {
      encode.resolve(new Float32Array([0.1, 0.2, 0.3]));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(chipVisible()).toBe(true);
    expect(screen.getByText("cat")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Similar/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(new URL(window.location.href).searchParams.get("topic")).toBe("cat");
  });

  // An app-driven advance (cadence tick) that replays a recorded forward-history
  // entry must NOT count as user navigation, so it may not stale a topic the
  // user just submitted. Isolated in similar mode so the safety-net effect stays
  // dormant.
  it("keeps a pending topic alive across a cadence advance that replays forward history", async () => {
    window.history.replaceState(window.history.state, "", "/slideshow?mode=similar");

    render(<SlideshowScreen />);
    await flush();

    // Build forward history: advance once (index 1) then step back (index 0),
    // leaving a recorded forward entry the next advance can replay.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    });
    await flush();

    // Submit a topic with a still-pending encode.
    const encode = deferred<Float32Array>();
    mockEncodeSearchText.mockReturnValue(encode.promise);
    await act(async () => {
      await submitTopic("cat");
    });

    // Cadence fires an APP-driven advance while the seed is in flight; there is
    // forward history, so goNext replays it via showHistoryPhoto.
    await act(async () => {
      cadenceOnAdvance();
      await Promise.resolve();
    });

    // The encode lands: because the app advance did not move the user-nav
    // counter, the seed is still fresh and commits.
    await act(async () => {
      encode.resolve(new Float32Array([0.1, 0.2, 0.3]));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(chipVisible()).toBe(true);
    expect(screen.getByText("cat")).toBeTruthy();
  });

  // A MANUAL next during the pending seed IS user intent and must supersede it,
  // proving the provenance really is threaded (not just globally suppressed).
  it("stales a pending topic when the user manually advances during the seed", async () => {
    window.history.replaceState(window.history.state, "", "/slideshow?mode=similar");

    render(<SlideshowScreen />);
    await flush();

    const encode = deferred<Float32Array>();
    mockEncodeSearchText.mockReturnValue(encode.promise);
    await act(async () => {
      await submitTopic("cat");
    });

    // Manual Next: a fresh user navigation that supersedes the in-flight seed.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });
    await flush();

    await act(async () => {
      encode.resolve(new Float32Array([0.1, 0.2, 0.3]));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    // The user moved on, so the landed seed is abandoned — no chip.
    expect(chipVisible()).toBe(false);
  });

  // A topic submitted AFTER a prior embeddings-load failure must defer and
  // retry, not be insta-killed by the stale error still present in the same
  // commit.
  it("defers (and retries) a fresh submit after a prior embeddings failure instead of aborting it", async () => {
    const staleError = new Error("previous embeddings load failed");
    mockUseEmbeddingsDatabase.mockReturnValue([
      null,
      0,
      undefined,
      staleError,
      mockRetryEmbeddings,
    ]);

    render(<SlideshowScreen />);
    await flush();

    await act(async () => {
      await submitTopic("cat");
    });
    await flush();

    // The fresh submit is held waiting on the embeddings DB and re-triggers the
    // load — it is NOT aborted with the unavailable-data error.
    expect(mockRetryEmbeddings).toHaveBeenCalled();
    expect(screen.getByText("Loading embeddings…")).toBeTruthy();
    expect(
      screen.queryByText("Couldn't load the similarity data — check the connection and try again."),
    ).toBeNull();
  });
});
