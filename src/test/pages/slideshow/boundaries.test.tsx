/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";

const database = { db: true };
let databaseValue: unknown = database;
let embeddingsValue: unknown = { embeddings: true };
let photos: any[] = [];
let remixPlan: any = { kind: "none" };
let pointerMoveResult: any = {
  kind: "update",
  hint: "next",
  pullProgress: 0,
  swipeProgress: 1,
  armed: true,
  committedHorizontal: "next",
};
let pointerUpResult: any = { action: "none", suppressClick: false };
let coarsePointer = false;
let wakeActive = false;
let syncCompanions = true;
let vibrate: jest.Mock;
const fetchSimilarResults = jest.fn();
const fetchRandomPhoto = jest.fn();
const fetchSlideshowPhotos = jest.fn();
const refreshDatabase = jest.fn();
const acquireWakeLock = jest.fn(async () => {});
const scheduleNextChange = jest.fn();
const alignNextChange = jest.fn();
const dismissControls = jest.fn();
const hideControls = jest.fn();
const toolbarProps = jest.fn();
const reloadCurrentPage = jest.fn();
const navigateTo = jest.fn();
let cadenceAdvance: () => void = () => {};

jest.mock("../../../components/database/useDatabase", () => ({
  SEARCH_DATABASE_URL: "/search.sqlite",
  useDatabase: () => [databaseValue, databaseValue ? 100 : 40, null, null, refreshDatabase],
  useEmbeddingsDatabase: () => [embeddingsValue, embeddingsValue ? 100 : 30],
}));
jest.mock("../../../components/search/api", () => ({
  fetchSlideshowPhotos: (...args: unknown[]) => fetchSlideshowPhotos(...args),
  fetchRandomPhoto: (...args: unknown[]) => fetchRandomPhoto(...args),
  fetchSimilarResults: (...args: unknown[]) => fetchSimilarResults(...args),
}));
jest.mock("../../../components/ProgressBar", () => ({
  ProgressBar: ({ progress, label }: { progress: number; label?: string }) => (
    <div>{label ?? `progress ${progress}`}</div>
  ),
}));
jest.mock("../../../components/ThemeToggle", () => ({ ThemeToggle: () => null }));
jest.mock("../../../components/Seo", () => ({ Seo: () => null }));
jest.mock("../../../components/useWakeLock", () => ({
  useWakeLock: () => ({
    ref: { current: wakeActive ? {} : null },
    isSupported: true,
    isActive: wakeActive,
    acquire: acquireWakeLock,
  }),
}));
jest.mock("../../../components/useControlsAutoHide", () => ({
  useControlsAutoHide: () => {
    const React = jest.requireActual<typeof import("react")>("react");
    const [controlsVisible, setControlsVisible] = React.useState(true);
    return {
      controlsVisible,
      setControlsVisible,
      controlsHideProgress: 0.5,
      isCoarsePointer: coarsePointer,
      setIsPointerOverToolbar: jest.fn(),
      extendControlsHideDeadline: jest.fn(),
      showControlsForDesktop: () => setControlsVisible(true),
      hideDesktopControls: () => {
        hideControls();
        setControlsVisible(false);
      },
      dismissControls: () => {
        dismissControls();
        setControlsVisible(false);
      },
    };
  },
}));
jest.mock("../../../components/useSlideshowCadence", () => ({
  useSlideshowCadence: ({ onAdvance }: { onAdvance: () => void }) => {
    cadenceAdvance = onAdvance;
    return {
      secondsLeft: 10,
      time: new Date("2026-07-14T12:00:00Z"),
      isPaused: false,
      togglePaused: jest.fn(),
      scheduleNextChange,
      alignNextChangeToCadence: alignNextChange,
    };
  },
}));
jest.mock("../../../components/useRemixGridReveal", () => ({
  useRemixGridReveal: () => ({ markRemixCellLoaded: jest.fn(), isRemixGridReady: true }),
}));
jest.mock("../../../util/slideshowRemix", () => ({
  decideRemixPlan: () => remixPlan,
  mapVectorRemixResult: ({ resultData }: { resultData: any[] }) => ({
    companions: resultData.slice(0, 1),
    topSimilarity: resultData[0]?.similarity ?? null,
  }),
}));
jest.mock("../../../util/slideshowAmbient", () => ({
  decideRemixCompanionCount: jest.fn(),
  rollRemixLayoutCount: jest.fn(),
  rollRemixStrategy: jest.fn(),
  timeAwareShufflePhotos: (pool: any[]) => [...pool],
  pickRemixCompanions: (
    seed: any,
    pool: any[],
    _count: number,
    _random: unknown,
    strategy: string,
  ) => ({
    companions: syncCompanions
      ? pool.filter((candidate) => candidate.path !== seed.path).slice(0, 1)
      : [],
    strategy,
  }),
}));
jest.mock("../../../util/slideshowGesture", () => ({
  resolvePointerMove: () => pointerMoveResult,
  resolvePointerUpAction: (input: any) => {
    input.tap.getBounds();
    return pointerUpResult;
  },
}));
jest.mock("../../../components/slideshow/SlideshowToolbar", () => ({
  SlideshowToolbar: (props: any) => {
    toolbarProps(props);
    return (
      <div>
        <button onClick={() => props.onSelectMode("random")}>mode random</button>
        <button onClick={() => props.onSelectMode("weighted")}>mode weighted</button>
        <button onClick={() => props.onSelectMode("similar")}>mode similar</button>
        <button onClick={props.onToggleTimeAware}>toggle time aware</button>
        <button onClick={props.onToggleRemix}>toggle remix</button>
        <button onClick={props.onRemixNow}>remix now</button>
        <button onClick={props.onPrevious}>previous</button>
        <button onClick={props.onNext}>next</button>
        <button onClick={props.onHide}>hide</button>
        <button onClick={props.onToggleClock}>clock</button>
        <button onClick={props.onToggleDetails}>details</button>
        <button onClick={props.onToggleMap}>map</button>
        <button onClick={props.onCycleAlignment}>alignment</button>
        <button onClick={props.onToggleCover}>cover</button>
        <button onClick={props.onToggleFullscreen}>fullscreen</button>
        <button onClick={props.onTryWakeLock}>wake</button>
        <button onClick={() => props.onSelectDelay(60000)}>delay</button>
        <button onClick={props.onToggleLongTimings}>long timings</button>
        <button onClick={props.onToggleAlign}>align cadence</button>
        <button onClick={props.onInspectImage}>inspect</button>
        <button onClick={props.onCopyLink}>copy</button>
        <button onClick={props.onShare}>share</button>
        <button onClick={props.onCheckDataVersion}>check data</button>
      </div>
    );
  },
}));
jest.mock("../../../components/slideshow/SlideshowBottomBar", () => ({
  SlideshowBottomBar: () => null,
}));
jest.mock("usehooks-ts", () => ({
  useLocalStorage: <T,>(_key: string, initial: T) => {
    const React = jest.requireActual<typeof import("react")>("react");
    const [value, setValue] = React.useState(initial);
    return [value, setValue, () => setValue(initial)] as const;
  },
}));
jest.mock("../../../lib/buildVersion", () => ({ BUILD_VERSION: "build-current" }));
jest.mock("../../../util/navigate", () => ({
  navigateTo: (...args: unknown[]) => navigateTo(...args),
  reloadCurrentPage: () => reloadCurrentPage(),
}));

import {
  Slideshow,
  formatSearchDbVersion,
  isTouchOrPen,
  remapSlideshowPeek,
} from "../../../screens/slideshow/SlideshowScreen";

const photo = (id: string, album = "trip") => ({
  path: `../albums/${album}/${id}.jpg`,
  exif: "",
  geocode: "",
  colors: [[1, 2, 3]],
});

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

const transition = (element: Element, propertyName: string) => {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  fireEvent(element, event);
};

describe("slideshow page boundaries", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    databaseValue = database;
    embeddingsValue = { embeddings: true };
    photos = [photo("one"), photo("two"), photo("three", "other")];
    remixPlan = { kind: "none" };
    pointerMoveResult = {
      kind: "update",
      hint: "next",
      pullProgress: 0,
      swipeProgress: 1,
      armed: true,
      committedHorizontal: "next",
    };
    pointerUpResult = { action: "none", suppressClick: false };
    coarsePointer = false;
    wakeActive = false;
    syncCompanions = true;
    fetchSlideshowPhotos.mockReset().mockImplementation(async () => photos);
    fetchRandomPhoto.mockReset().mockResolvedValue([photos[1]]);
    fetchSimilarResults.mockReset().mockResolvedValue({ data: [photos[1]] });
    refreshDatabase.mockReset();
    acquireWakeLock.mockClear();
    scheduleNextChange.mockClear();
    alignNextChange.mockClear();
    toolbarProps.mockClear();
    reloadCurrentPage.mockClear();
    navigateTo.mockClear();
    window.history.replaceState({}, "", "/slideshow");
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/version.json") return { ok: false } as Response;
      if (init?.method === "HEAD") return { ok: false } as Response;
      return { ok: false } as Response;
    });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    vibrate = jest.fn();
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn() },
    });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    Object.defineProperty(document, "webkitFullscreenElement", { configurable: true, value: null });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: undefined });
    Object.defineProperty(document, "webkitExitFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document.documentElement, "webkitRequestFullscreen", {
      configurable: true,
      value: undefined,
    });
    Element.prototype.setPointerCapture = jest.fn();
    Element.prototype.releasePointerCapture = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => true);
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: jest.fn().mockResolvedValue(undefined),
    });
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("formats database versions and recognises touch-like pointers", () => {
    const response = (headers: Record<string, string>) =>
      ({
        headers: { get: (name: string) => headers[name] ?? null },
      }) as unknown as Response;
    expect(
      formatSearchDbVersion(response({ "last-modified": "14 Jul 2026 12:00:00 GMT", etag: "tag" })),
    ).toMatchObject({ raw: "tag" });
    expect(
      formatSearchDbVersion(response({ "last-modified": "14 Jul 2026 12:00:00 GMT" })),
    ).toMatchObject({ raw: "14 Jul 2026 12:00:00 GMT" });
    expect(
      formatSearchDbVersion(response({ "last-modified": "invalid", etag: 'W/"123456789012345"' })),
    ).toMatchObject({ label: "data 123456789012..." });
    expect(formatSearchDbVersion(response({ etag: '"short"' }))).toMatchObject({
      label: "data short",
    });
    expect(formatSearchDbVersion(response({}))).toBeNull();
    expect(isTouchOrPen("touch")).toBe(true);
    expect(isTouchOrPen("pen")).toBe(true);
    expect(isTouchOrPen("mouse")).toBe(false);
    expect(remapSlideshowPeek(0.5)).toBe(0);
    expect(remapSlideshowPeek(1)).toBeCloseTo(1);
  });

  it("drives toolbar settings, history, loading, errors, and image lifecycle", async () => {
    const view = render(<Slideshow />);
    await flush();
    const image = screen.getByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "previous" }));
    transition(image, "opacity");
    fireEvent.load(image);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    act(() => cadenceAdvance());
    fireEvent.click(screen.getByRole("button", { name: "previous" }));
    fireEvent.click(screen.getByRole("button", { name: "previous" }));
    for (const name of [
      "mode random",
      "mode weighted",
      "toggle time aware",
      "toggle remix",
      "remix now",
      "hide",
      "clock",
      "details",
      "map",
      "alignment",
      "alignment",
      "alignment",
      "cover",
      "delay",
      "long timings",
      "align cadence",
      "align cadence",
      "wake",
      "copy",
      "share",
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(hideControls).toHaveBeenCalled();
    expect(scheduleNextChange).toHaveBeenCalled();

    fireEvent.error(screen.getByRole("img"));
    fireEvent.error(screen.getByRole("img"));
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    act(() => {
      jest.advanceTimersByTime(6000);
    });
    view.unmount();
  });

  it("supports sync and vector remixes", async () => {
    remixPlan = { kind: "sync", count: 1, strategy: "same-album" };
    const syncView = render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await flush();
    expect(document.querySelectorAll("img").length).toBeGreaterThan(1);
    for (const image of Array.from(document.querySelectorAll("img"))) {
      Object.defineProperty(image, "decode", {
        configurable: true,
        value: jest.fn().mockRejectedValue(new Error("decode")),
      });
      fireEvent.load(image);
      fireEvent.error(image);
    }
    const remixGrid = document.querySelector("[data-count]");
    if (remixGrid) {
      fireEvent.transitionEnd(remixGrid, { propertyName: "transform" });
      fireEvent.transitionEnd(remixGrid, { propertyName: "opacity" });
    }
    syncView.unmount();

    remixPlan = { kind: "vector", count: 1, strategy: "similar", isAntiSimilar: false };
    const vectorView = render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await flush();
    expect(fetchSimilarResults).toHaveBeenCalled();

    fetchSimilarResults.mockRejectedValueOnce(new Error("vector unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await flush();
    vectorView.unmount();

    remixPlan = { kind: "vector", count: 1, strategy: "juxtapose", isAntiSimilar: true };
    fetchSimilarResults.mockResolvedValueOnce({ data: [] });
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await flush();
  });

  it("keeps a sync remix single when no companion is eligible", async () => {
    syncCompanions = false;
    remixPlan = { kind: "sync", count: 1, strategy: "same-album" };
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(document.querySelector("[data-count]")).toBeNull();
  });

  it("keeps a vector remix as a single image when no companions map", async () => {
    remixPlan = { kind: "vector", count: 1, strategy: "juxtapose", isAntiSimilar: true };
    fetchSimilarResults.mockResolvedValue({ data: [] });
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await flush();
    expect(fetchSimilarResults).toHaveBeenCalledWith(
      expect.objectContaining({
        similarityOrder: "least",
      }),
    );
    expect(document.querySelector("[data-count]")).toBeNull();
  });

  it("loads a random similarity seed and advances a similar queue", async () => {
    window.history.replaceState({}, "", "/slideshow?mode=similar&random=1&filter=trip");
    render(<Slideshow />);
    await flush();
    expect(fetchRandomPhoto).toHaveBeenCalledWith({ database, filter: "trip" });
    fetchSimilarResults.mockResolvedValueOnce({ data: [photos[0]] });
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await flush();
    expect(fetchSimilarResults).toHaveBeenCalled();
  });

  it("continues when a random similarity seed is unavailable or missing from the pool", async () => {
    fetchRandomPhoto.mockResolvedValueOnce([]);
    window.history.replaceState({}, "", "/slideshow?mode=similar&random=1&filter=trip");
    const unavailable = render(<Slideshow />);
    await flush();
    expect(screen.getByRole("img")).toBeInTheDocument();
    unavailable.unmount();

    window.history.replaceState({}, "", "/slideshow?mode=random&photo=../albums/trip/missing.jpg");
    render(<Slideshow />);
    await flush();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("handles fullscreen variants", async () => {
    const request = jest.fn(async () => {});
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: request,
    });
    const view = render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "fullscreen" }));
    await flush();
    expect(request).toHaveBeenCalled();
    view.unmount();

    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document.documentElement, "webkitRequestFullscreen", {
      configurable: true,
      value: jest.fn(async () => {}),
    });
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "fullscreen" }));
    await flush();
  });

  it("resolves pointer gesture outcomes", async () => {
    coarsePointer = true;
    render(<Slideshow />);
    await flush();
    const actions = ["remix", "hide-controls", "show-controls", "next", "previous", "none"];
    for (const action of actions) {
      pointerUpResult = { action, suppressClick: true };
      pointerMoveResult =
        action === "show-controls"
          ? {
              kind: "update",
              hint: "controls",
              pullProgress: 0.8,
              swipeProgress: 0,
              armed: false,
              committedVertical: "down",
            }
          : {
              kind: "update",
              hint: action === "remix" ? "remix" : "next",
              pullProgress: 0.8,
              swipeProgress: 1,
              armed: true,
              committedHorizontal: "next",
            };
      const currentImage = screen.getByRole("img");
      pointer(currentImage, "pointerdown", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 10,
        clientY: 10,
        button: 0,
      });
      pointer(currentImage, "pointermove", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 100,
        clientY: 10,
      });
      pointer(currentImage, "pointermove", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 110,
        clientY: 10,
      });
      pointer(currentImage, "pointerup", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 100,
        clientY: 10,
      });
      fireEvent.click(currentImage);
    }
    pointer(screen.getByRole("img"), "pointercancel", { pointerId: 1, pointerType: "touch" });
    pointerUpResult = { action: "none", suppressClick: false };
    const finalImage = screen.getByRole("img");
    pointer(finalImage, "pointerdown", {
      pointerId: 7,
      pointerType: "touch",
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    pointer(finalImage, "pointerup", {
      pointerId: 7,
      pointerType: "touch",
      clientX: 0,
      clientY: 0,
    });
    expect(vibrate).toHaveBeenCalled();
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: undefined });
    pointerMoveResult = {
      kind: "update",
      hint: "next",
      pullProgress: 0,
      swipeProgress: 1,
      armed: true,
    };
    const silentImage = screen.getByRole("img");
    pointer(silentImage, "pointerdown", {
      pointerId: 8,
      pointerType: "touch",
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    pointer(silentImage, "pointermove", {
      pointerId: 8,
      pointerType: "touch",
      clientX: 50,
      clientY: 0,
    });
  });

  it("runs online, visibility, database, and fallback polling paths", async () => {
    let dbEtag: string | null = null;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/version.json") {
        return { ok: true, json: async () => ({ buildVersion: "build-current" }) } as Response;
      }
      if (init?.method === "HEAD") {
        return {
          ok: true,
          headers: { get: (name: string) => (name === "etag" ? dbEtag : null) },
        } as unknown as Response;
      }
      return { ok: false } as Response;
    });
    const view = render(<Slideshow />);
    await flush();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    await flush();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    dbEtag = '"same"';
    fireEvent.click(screen.getByRole("button", { name: "check data" }));
    await flush();
    dbEtag = '"changed"';
    fireEvent.click(screen.getByRole("button", { name: "check data" }));
    await flush();
    databaseValue = { db: "refreshed" };
    view.rerender(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "check data" }));
    await flush();
    act(() => {
      jest.advanceTimersByTime(600000);
    });
    act(() => {
      jest.advanceTimersByTime(7 * 86400000);
    });
    expect(reloadCurrentPage).toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => {
      jest.advanceTimersByTime(600000);
    });
  });

  it("preserves kiosk sessions during the fallback interval", async () => {
    wakeActive = true;
    render(<Slideshow />);
    await flush();
    act(() => {
      jest.advanceTimersByTime(7 * 86400000);
    });
    expect(reloadCurrentPage).not.toHaveBeenCalled();
  });

  it("reports polling failures without breaking the slideshow", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (input === "/version.json") throw new Error("manifest offline");
      throw new Error("database offline");
    });
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "check data" }));
    await flush();
    expect(error).toHaveBeenCalledWith(expect.any(Error));
    expect(error).toHaveBeenCalledWith("DB update check failed", expect.any(Error));
  });

  it("ignores a rejected pool request after unmount", async () => {
    let rejectPool!: (reason: Error) => void;
    fetchSlideshowPhotos.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectPool = reject;
      }),
    );
    const view = render(<Slideshow />);
    view.unmount();
    await act(async () => rejectPool(new Error("cancelled")));
  });

  it("applies every optional URL setting and handles an empty or failed pool", async () => {
    window.history.replaceState(
      {},
      "",
      "/slideshow?mode=similar&time=1&remix=0&align_cadence=0&shuffle=7",
    );
    photos = [];
    const empty = render(<Slideshow />);
    await flush();
    expect(screen.getByText("No photos available")).toBeInTheDocument();
    empty.unmount();

    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    fetchSlideshowPhotos.mockRejectedValueOnce(new Error("query failed"));
    render(<Slideshow />);
    await flush();
    expect(error).toHaveBeenCalledWith(expect.any(Error));
  });

  it("falls back from similar mode while embeddings load and handles trail failures", async () => {
    embeddingsValue = null;
    window.history.replaceState({}, "", "/slideshow?mode=similar");
    const view = render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await flush();
    view.unmount();

    embeddingsValue = { embeddings: true };
    window.history.replaceState({}, "", "/slideshow");
    fetchSimilarResults.mockRejectedValueOnce(new Error("trail failed"));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "mode similar" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await flush();
    expect(error).toHaveBeenCalled();
  });

  it("falls back to random when a similar trail has no eligible result", async () => {
    window.history.replaceState({}, "", "/slideshow?mode=similar");
    fetchSimilarResults.mockResolvedValue({ data: [] });
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await flush();
    expect(scheduleNextChange).toHaveBeenCalled();
  });

  it("maps an eligible similar result without an album filter", async () => {
    window.history.replaceState({}, "", "/slideshow?mode=similar");
    fetchSimilarResults.mockResolvedValue({ data: [photo("fresh")] });
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await flush();
    expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("fresh"));
  });

  it("guards database actions after the database disconnects", async () => {
    const view = render(<Slideshow />);
    await flush();
    databaseValue = null;
    view.rerender(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "check data" }));
    fireEvent.click(screen.getByRole("button", { name: "next" }));
  });

  it("recommits a similar slide when a refreshed database lands", async () => {
    window.history.replaceState(
      {},
      "",
      `/slideshow?mode=similar&photo=${encodeURIComponent(photos[0].path)}`,
    );
    const view = render(<Slideshow />);
    await flush();
    databaseValue = { db: "new identity" };
    view.rerender(<Slideshow />);
    await flush();
    expect(scheduleNextChange).toHaveBeenCalled();
  });

  it("ignores pool results after unmount", async () => {
    let resolvePool!: (value: any[]) => void;
    fetchSlideshowPhotos.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePool = resolve;
      }),
    );
    const poolView = render(<Slideshow />);
    poolView.unmount();
    await act(async () => resolvePool(photos));
  });

  it("ignores a random similarity seed after unmount", async () => {
    let resolveRandom!: (value: any[]) => void;
    fetchRandomPhoto.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRandom = resolve;
      }),
    );
    window.history.replaceState({}, "", "/slideshow?mode=similar&random=1&filter=trip");
    const randomView = render(<Slideshow />);
    await flush();
    expect(fetchRandomPhoto).toHaveBeenCalled();
    randomView.unmount();
    await act(async () => resolveRandom([photos[0]]));
  });

  it("exercises keyboard history and image transition behaviour", async () => {
    const view = render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    const image = screen.getByRole("img");
    Object.defineProperty(image, "decode", {
      configurable: true,
      value: jest.fn().mockRejectedValue(new Error("decode")),
    });
    fireEvent.load(image);
    await flush();
    fireEvent.transitionEnd(image, { propertyName: "transform" });
    fireEvent.transitionEnd(image, { propertyName: "opacity" });
    fireEvent.click(image);
    view.unmount();
  });

  it("supports clipboard fallback, web share success/failure, and copy errors", async () => {
    window.history.replaceState({}, "", "/slideshow?filter=trip");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const execCommand = jest.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    const view = render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "copy" }));
    await flush();
    expect(execCommand).toHaveBeenCalledWith("copy");
    act(() => {
      jest.advanceTimersByTime(1800);
    });

    const share = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("cancel"));
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    fireEvent.click(screen.getByRole("button", { name: "share" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "share" }));
    await flush();
    expect(share).toHaveBeenCalledTimes(2);
    view.unmount();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn().mockRejectedValue(new Error("denied")) },
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "copy" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Could not copy photo link");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.click(screen.getByRole("button", { name: "copy" }));
    await flush();
    act(() => {
      jest.advanceTimersByTime(6000);
    });
    expect(error).toHaveBeenCalled();
  });

  it("inspects image metadata with and without a content length", async () => {
    const alert = jest.spyOn(window, "alert").mockImplementation(() => {});
    global.fetch = jest.fn(async () => ({
      headers: { get: (name: string) => (name === "content-length" ? "2048" : null) },
    })) as jest.Mock;
    const view = render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "inspect" }));
    await flush();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("bytes 2 KB"));
    view.unmount();

    global.fetch = jest.fn(async () => ({ headers: { get: () => null } })) as jest.Mock;
    const noBytes = render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "inspect" }));
    await flush();
    noBytes.unmount();

    global.fetch = jest.fn().mockRejectedValue(new Error("head failed"));
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "inspect" }));
    await flush();
    expect(alert).toHaveBeenCalled();
  });

  it("handles unavailable, rejected, and active fullscreen APIs", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document.documentElement, "webkitRequestFullscreen", {
      configurable: true,
      value: undefined,
    });
    const unavailable = render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "fullscreen" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Fullscreen is not available");
    unavailable.unmount();

    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: jest.fn().mockRejectedValue(new Error("blocked")),
    });
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "fullscreen" }));
    await flush();
    expect(error).toHaveBeenCalled();
  });

  it("falls through when fullscreen is active without an exit API", async () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.body,
    });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: undefined });
    Object.defineProperty(document, "webkitExitFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document.documentElement, "webkitRequestFullscreen", {
      configurable: true,
      value: undefined,
    });
    render(<Slideshow />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Fullscreen is not available");
  });

  it("exits standard and webkit fullscreen sessions", async () => {
    const exit = jest.fn(async () => {});
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.body,
    });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    const standard = render(<Slideshow />);
    await flush();
    document.dispatchEvent(new Event("fullscreenchange"));
    fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
    await flush();
    expect(exit).toHaveBeenCalled();
    standard.unmount();

    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: undefined });
    Object.defineProperty(document, "webkitFullscreenElement", {
      configurable: true,
      value: document.body,
    });
    const webkitExit = jest.fn(async () => {});
    Object.defineProperty(document, "webkitExitFullscreen", {
      configurable: true,
      value: webkitExit,
    });
    render(<Slideshow />);
    await flush();
    document.dispatchEvent(new Event("webkitfullscreenchange"));
    fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
    await flush();
    expect(webkitExit).toHaveBeenCalled();
  });

  it("handles rejected wake locks and defensive pointer paths", async () => {
    acquireWakeLock.mockRejectedValueOnce(new Error("wake denied"));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const debug = jest.spyOn(console, "debug").mockImplementation(() => {});
    render(<Slideshow />);
    await flush();
    const container = document.querySelector("[data-controls-visible]")!;
    fireEvent.touchStart(container);
    await flush();
    const image = screen.getByRole("img");
    pointer(image, "pointerdown", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
      button: 2,
    });
    pointer(image, "pointerdown", {
      pointerId: 3,
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    pointer(image, "pointercancel", { pointerId: 3, pointerType: "mouse" });
    pointer(image, "pointermove", { pointerId: 99, pointerType: "touch", clientX: 1, clientY: 1 });
    pointer(image, "pointerup", { pointerId: 99, pointerType: "touch", clientX: 1, clientY: 1 });
    pointerMoveResult = { kind: "ignore" };
    pointer(image, "pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    pointer(image, "pointermove", { pointerId: 2, pointerType: "touch", clientX: 1, clientY: 1 });
    Element.prototype.releasePointerCapture = jest.fn(() => {
      throw new Error("stale");
    });
    pointer(image, "pointercancel", { pointerId: 2, pointerType: "touch" });
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    pointer(image, "pointercancel", { pointerId: 2, pointerType: "touch" });
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: undefined });
    expect(error).toHaveBeenCalled();
    expect(debug).toHaveBeenCalled();
  });

  it("does not reacquire a wake lock when disabled or already active", async () => {
    const disabled = render(<Slideshow disabled />);
    await flush();
    fireEvent.touchStart(document.querySelector("[data-controls-visible]")!);
    pointer(screen.getByRole("img"), "pointerdown", {
      pointerId: 4,
      pointerType: "touch",
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    expect(acquireWakeLock).not.toHaveBeenCalled();
    disabled.unmount();

    wakeActive = true;
    render(<Slideshow />);
    await flush();
    fireEvent.touchStart(document.querySelector("[data-controls-visible]")!);
    expect(acquireWakeLock).not.toHaveBeenCalled();
  });
});
