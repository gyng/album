/**
 * @jest-environment jsdom
 */

import { act, render, renderHook } from "@testing-library/react";
import type { MapWorldEntry } from "../util/pageDataTypes";
import {
  LazyMapMarkerImage,
  MapAutoFit,
  MapBoundsTracker,
  MapFitOnRequest,
  MapMiddleDragOrbit,
  useSharedMapMarkerObserver,
} from "./MapWorldMapChildren";

let currentMap: any = null;
jest.mock("./map/adapters/maplibre", () => ({ useMap: () => ({ current: currentMap }) }));

const photo = (overrides: Partial<MapWorldEntry> = {}): MapWorldEntry => ({
  album: "test-simple",
  src: { src: "/photo.jpg", width: 100, height: 80 },
  decLat: 1,
  decLng: 103,
  date: null,
  href: "/album/test-simple#photo.jpg",
  ...overrides,
});

const pointerEvent = (
  type: string,
  values: { button?: number; pointerId?: number; clientX?: number; clientY?: number } = {},
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: values.button ?? 0 },
    pointerId: { value: values.pointerId ?? 1 },
    clientX: { value: values.clientX ?? 0 },
    clientY: { value: values.clientY ?? 0 },
  });
  return event;
};

describe("MapAutoFit", () => {
  const flyTo = jest.fn();
  const fitBounds = jest.fn();

  beforeEach(() => {
    flyTo.mockClear();
    fitBounds.mockClear();
    currentMap = { flyTo, fitBounds };
  });

  it.each([
    [false, [photo()], true],
    [true, [], true],
    [true, [photo({ decLat: null }), photo({ decLng: null })], true],
    [true, [photo()], false],
  ])("does not move without usable fit input", (enabled, photos, hasMap) => {
    currentMap = hasMap ? { flyTo, fitBounds } : null;
    render(<MapAutoFit enabled={enabled} photos={photos as MapWorldEntry[]} />);
    expect(flyTo).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("flies to one located photo", () => {
    render(<MapAutoFit enabled photos={[photo()]} />);
    expect(flyTo).toHaveBeenCalledWith({ center: [103, 1], zoom: 10.5, speed: 2.2 });
  });

  it("fits several photos, including an antimeridian-aware span", () => {
    render(
      <MapAutoFit enabled photos={[photo({ decLng: 179 }), photo({ decLat: 2, decLng: -179 })]} />,
    );
    expect(fitBounds).toHaveBeenCalledWith(
      [
        [179, 1],
        [-179, 2],
      ],
      { padding: 36, duration: 0, maxZoom: 11 },
    );
  });
});

describe("MapFitOnRequest", () => {
  const flyTo = jest.fn();
  const fitBounds = jest.fn();

  beforeEach(() => {
    flyTo.mockClear();
    fitBounds.mockClear();
    currentMap = { flyTo, fitBounds };
  });

  it("does not fit on mount, nor when only the photos change", () => {
    const { rerender } = render(<MapFitOnRequest requestId={0} photos={[photo()]} />);
    // Refining a search changes the photos but not the request id: filter in
    // place, leaving the map where the user put it.
    rerender(<MapFitOnRequest requestId={0} photos={[photo({ decLng: 104 })]} />);
    expect(flyTo).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("frames the photos current at the moment the request id increments", () => {
    const { rerender } = render(<MapFitOnRequest requestId={0} photos={[photo()]} />);
    rerender(<MapFitOnRequest requestId={1} photos={[photo({ decLat: 5, decLng: 50 })]} />);
    expect(flyTo).toHaveBeenCalledWith({ center: [50, 5], zoom: 10.5, speed: 2.2 });
  });
});

describe("useSharedMapMarkerObserver", () => {
  const observe = jest.fn();
  const unobserve = jest.fn();
  const disconnect = jest.fn();
  let notify!: IntersectionObserverCallback;

  beforeEach(() => {
    observe.mockClear();
    unobserve.mockClear();
    disconnect.mockClear();
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: jest.fn((callback: IntersectionObserverCallback) => {
        notify = callback;
        return { observe, unobserve, disconnect };
      }),
    });
  });

  it("shares an observer and routes visibility to each element", () => {
    const view = renderHook(() => useSharedMapMarkerObserver());
    const first = document.createElement("div");
    const second = document.createElement("div");
    const onFirst = jest.fn();
    const onSecond = jest.fn();
    const stopFirst = view.result.current(first, onFirst);
    view.result.current(second, onSecond);

    expect(IntersectionObserver).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls).toEqual([[first], [second]]);
    act(() => {
      notify(
        [
          { target: first, isIntersecting: true },
          { target: second, isIntersecting: false },
          { target: document.createElement("div"), isIntersecting: true },
        ] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    });
    expect(onFirst).toHaveBeenCalledWith(true);
    expect(onSecond).toHaveBeenCalledWith(false);

    stopFirst();
    expect(unobserve).toHaveBeenCalledWith(first);
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("falls back to a harmless disposer without IntersectionObserver", () => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useSharedMapMarkerObserver());
    const dispose = result.current(document.createElement("div"), jest.fn());
    expect(dispose()).toBeUndefined();
  });
});

describe("LazyMapMarkerImage", () => {
  it("uses placeholder dimensions and colour without exposing decorative content", () => {
    const { rerender } = render(
      <LazyMapMarkerImage
        photo={photo({
          placeholderWidth: 40,
          placeholderHeight: 30,
          placeholderColor: "rgb(1, 2, 3)",
        })}
      />,
    );
    const image = document.querySelector("img")!;
    expect(image).toHaveAttribute("src", "/photo.jpg");
    expect(image).toHaveAttribute("width", "40");
    expect(image).toHaveStyle({ backgroundColor: "rgb(1, 2, 3)" });
    expect(image).toHaveAttribute("aria-hidden", "true");

    rerender(<LazyMapMarkerImage photo={photo()} />);
    expect(image).not.toHaveAttribute("width");
  });
});

describe("MapBoundsTracker", () => {
  const on = jest.fn();
  const off = jest.fn();
  const onBoundsChange = jest.fn();
  let moveEnd!: () => void;

  beforeEach(() => {
    on.mockImplementation((event: string, callback: () => void) => {
      if (event === "moveend") moveEnd = callback;
    });
    off.mockClear();
    onBoundsChange.mockClear();
  });

  it("publishes initial and subsequent map bounds and removes listeners", () => {
    const bounds = {
      getNorth: () => 10,
      getSouth: () => -10,
      getEast: () => 120,
      getWest: () => 80,
    };
    currentMap = { getBounds: jest.fn(() => bounds), on, off };
    const view = render(<MapBoundsTracker onBoundsChange={onBoundsChange} />);
    expect(onBoundsChange).toHaveBeenCalledWith({ north: 10, south: -10, east: 120, west: 80 });
    act(() => moveEnd());
    expect(onBoundsChange).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(off.mock.calls.map(([event]) => event)).toEqual(["moveend", "zoomend"]);
  });

  it("waits for both a map and available bounds", () => {
    currentMap = null;
    const first = render(<MapBoundsTracker onBoundsChange={onBoundsChange} />);
    first.unmount();
    currentMap = { getBounds: () => null, on, off };
    render(<MapBoundsTracker onBoundsChange={onBoundsChange} />);
    expect(onBoundsChange).not.toHaveBeenCalled();
  });
});

describe("MapMiddleDragOrbit", () => {
  const jumpTo = jest.fn();
  const enable = jest.fn();
  const disable = jest.fn();
  const onInteractionStart = jest.fn();
  let canvas: HTMLDivElement;
  let dragPanEnabled = true;

  beforeEach(() => {
    jumpTo.mockClear();
    enable.mockClear();
    disable.mockClear();
    onInteractionStart.mockClear();
    canvas = document.createElement("div");
    dragPanEnabled = true;
    currentMap = {
      getCanvasContainer: () => canvas,
      dragPan: {
        isEnabled: () => dragPanEnabled,
        enable,
        disable,
      },
      getBearing: () => 10,
      getPitch: () => 20,
      jumpTo,
    };
  });

  it("orbits with the middle button and restores drag-pan on release", () => {
    render(<MapMiddleDragOrbit onInteractionStart={onInteractionStart} />);
    const down = pointerEvent("pointerdown", { button: 1, pointerId: 7, clientX: 10, clientY: 20 });
    canvas.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(onInteractionStart).toHaveBeenCalled();
    expect(disable).toHaveBeenCalled();
    expect(canvas.className).toContain("orbiting");

    window.dispatchEvent(pointerEvent("pointermove", { pointerId: 8, clientX: 20, clientY: 30 }));
    expect(jumpTo).not.toHaveBeenCalled();
    const move = pointerEvent("pointermove", { pointerId: 7, clientX: 20, clientY: 30 });
    window.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
    expect(jumpTo).toHaveBeenCalledWith({ bearing: 13.5, pitch: 17.5 });

    window.dispatchEvent(pointerEvent("pointerup", { pointerId: 8 }));
    expect(enable).not.toHaveBeenCalled();
    window.dispatchEvent(pointerEvent("pointerup", { pointerId: 7 }));
    expect(enable).toHaveBeenCalled();
    expect(canvas.className).not.toContain("orbiting");
  });

  it("ignores ordinary pointer work and suppresses only middle aux-click", () => {
    render(<MapMiddleDragOrbit onInteractionStart={onInteractionStart} />);
    canvas.dispatchEvent(pointerEvent("pointerdown", { button: 0 }));
    window.dispatchEvent(pointerEvent("pointermove", { pointerId: 1 }));
    const ordinary = pointerEvent("auxclick", { button: 0 });
    const middle = pointerEvent("auxclick", { button: 1 });
    canvas.dispatchEvent(ordinary);
    canvas.dispatchEvent(middle);
    expect(ordinary.defaultPrevented).toBe(false);
    expect(middle.defaultPrevented).toBe(true);
    expect(onInteractionStart).not.toHaveBeenCalled();
  });

  it("does not enable drag-pan if it began disabled and finishes active drag on cleanup", () => {
    dragPanEnabled = false;
    const view = render(<MapMiddleDragOrbit onInteractionStart={onInteractionStart} />);
    canvas.dispatchEvent(pointerEvent("pointerdown", { button: 1, pointerId: 4 }));
    expect(disable).not.toHaveBeenCalled();
    view.unmount();
    expect(enable).not.toHaveBeenCalled();
    expect(canvas.className).not.toContain("orbiting");
  });

  it("waits for a map instance", () => {
    currentMap = null;
    render(<MapMiddleDragOrbit onInteractionStart={onInteractionStart} />);
    expect(onInteractionStart).not.toHaveBeenCalled();
  });
});
