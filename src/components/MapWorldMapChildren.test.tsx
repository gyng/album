/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render } from "@testing-library/react";
import type { MapWorldEntry } from "../util/pageDataTypes";
import {
  LazyMapMarkerImage,
  MARKER_PREVIEW_EXTENT_PX,
  MARKER_RENDER_PADDING_PX,
  MapAutoFit,
  MapBoundsTracker,
  MapFitOnRequest,
  MapMiddleDragOrbit,
} from "./MapWorldMapChildren";

let currentMap: any = null;
jest.mock("./map", () => ({ useMap: () => currentMap ?? undefined }));

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
    expect(flyTo).toHaveBeenCalledWith({
      center: { lng: 103, lat: 1 },
      zoom: 10.5,
      speed: 2.2,
    });
  });

  it("fits several photos, including an antimeridian-aware span", () => {
    render(
      <MapAutoFit enabled photos={[photo({ decLng: 179 }), photo({ decLat: 2, decLng: -179 })]} />,
    );
    expect(fitBounds).toHaveBeenCalledWith(
      [
        { lng: 179, lat: 1 },
        { lng: -179, lat: 2 },
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
    expect(flyTo).toHaveBeenCalledWith({ center: { lng: 50, lat: 5 }, zoom: 10.5, speed: 2.2 });
  });
});

describe("marker virtualisation padding", () => {
  it("mounts markers far enough outside the viewport to cover the tallest one", () => {
    // The bounds are keyed to a marker's *anchor*, but what the reader sees is
    // the thumbnail hanging above it — 99px for a plain one, 139px for the
    // preview form that also carries a label. Padding below that drops markers
    // whose picture is still partly on screen, which reads as thumbnails
    // popping out at the edges.
    expect(MARKER_RENDER_PADDING_PX).toBeGreaterThanOrEqual(MARKER_PREVIEW_EXTENT_PX);
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

  it("stays transparent until the photo itself has arrived", () => {
    // The fade used to run from mount, so a slow image faded its placeholder
    // colour in and then snapped to the photo. Deferring it to `load` makes the
    // one transition the reader sees be the picture appearing.
    render(<LazyMapMarkerImage photo={photo()} />);
    const image = document.querySelector("img")!;
    expect(image).toHaveAttribute("data-loaded", "false");

    fireEvent.load(image);
    expect(image).toHaveAttribute("data-loaded", "true");
  });
});

describe("MapBoundsTracker", () => {
  const on = jest.fn();
  const unsubscribed: string[] = [];
  const onBoundsChange = jest.fn();
  let moveEnd!: () => void;

  beforeEach(() => {
    on.mockClear();
    // The port hands back an unsubscribe rather than taking an `off` pair.
    on.mockImplementation((event: string, callback: () => void) => {
      if (event === "moveend") moveEnd = callback;
      return () => {
        unsubscribed.push(event);
      };
    });
    unsubscribed.length = 0;
    onBoundsChange.mockClear();
  });

  it("publishes initial and subsequent map bounds and removes listeners", () => {
    const bounds = [
      { lng: 80, lat: -10 },
      { lng: 120, lat: 10 },
    ];
    currentMap = { getBounds: jest.fn(() => bounds), on };
    const view = render(<MapBoundsTracker onBoundsChange={onBoundsChange} />);
    expect(onBoundsChange).toHaveBeenCalledWith({ north: 10, south: -10, east: 120, west: 80 });
    act(() => moveEnd());
    expect(onBoundsChange).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(unsubscribed).toEqual(["moveend", "zoomend", "move"]);
  });

  it("waits for a map", () => {
    currentMap = null;
    render(<MapBoundsTracker onBoundsChange={onBoundsChange} />);
    expect(onBoundsChange).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
  });

  it("also reports the viewport grown by a pixel padding, converted to degrees", () => {
    const bounds = [
      { lng: 80, lat: -10 },
      { lng: 120, lat: 10 },
    ];
    // A 400x200 viewport: 100px is a quarter of the width (10deg of the 40deg
    // longitude span) and half the height (10deg of the 20deg latitude span).
    const container = { clientWidth: 400, clientHeight: 200 } as HTMLElement;
    currentMap = { getBounds: jest.fn(() => bounds), on, getContainer: () => container };
    const onRenderBoundsChange = jest.fn();
    render(
      <MapBoundsTracker
        onBoundsChange={onBoundsChange}
        onRenderBoundsChange={onRenderBoundsChange}
        renderPadding={100}
      />,
    );
    expect(onBoundsChange).toHaveBeenCalledWith({ north: 10, south: -10, east: 120, west: 80 });
    expect(onRenderBoundsChange).toHaveBeenCalledWith(
      { north: 20, south: -20, east: 130, west: 70 },
      // The container's size travels with the bounds: thinning thumbnails by how
      // far apart they look is a screen measurement, not a geographic one.
      { width: 400, height: 200 },
    );
  });

  it("streams the render bounds during a gesture, throttled, without churning the exact bounds", () => {
    // Bounds used to settle only at `moveend`, so a drag emptied the map: the
    // markers it left behind unmounted while nothing ahead of it could mount
    // until the reader let go. The exact bounds stay gesture-end — the keyboard
    // list and tap targets have no business changing mid-drag.
    jest.useFakeTimers();
    const bounds = [
      { lng: 80, lat: -10 },
      { lng: 120, lat: 10 },
    ];
    const container = { clientWidth: 400, clientHeight: 200 } as HTMLElement;
    let move!: () => void;
    on.mockImplementation((event: string, callback: () => void) => {
      if (event === "moveend") moveEnd = callback;
      if (event === "move") move = callback;
      return () => {
        unsubscribed.push(event);
      };
    });
    currentMap = { getBounds: jest.fn(() => bounds), on, getContainer: () => container };
    const onRenderBoundsChange = jest.fn();
    render(
      <MapBoundsTracker
        onBoundsChange={onBoundsChange}
        onRenderBoundsChange={onRenderBoundsChange}
        renderPadding={100}
      />,
    );
    onRenderBoundsChange.mockClear();
    onBoundsChange.mockClear();

    act(() => {
      move();
      move();
      move();
    });
    expect(onRenderBoundsChange).toHaveBeenCalledTimes(1);
    expect(onBoundsChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1000);
      move();
    });
    expect(onRenderBoundsChange).toHaveBeenCalledTimes(2);
    expect(onBoundsChange).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it("leaves the reported bounds unpadded when no padding is asked for", () => {
    const bounds = [
      { lng: 80, lat: -10 },
      { lng: 120, lat: 10 },
    ];
    const container = { clientWidth: 400, clientHeight: 200 } as HTMLElement;
    currentMap = { getBounds: jest.fn(() => bounds), on, getContainer: () => container };
    const onRenderBoundsChange = jest.fn();
    render(
      <MapBoundsTracker
        onBoundsChange={onBoundsChange}
        onRenderBoundsChange={onRenderBoundsChange}
      />,
    );
    expect(onRenderBoundsChange).toHaveBeenCalledWith(
      { north: 10, south: -10, east: 120, west: 80 },
      { width: 400, height: 200 },
    );
  });
});

describe("MapMiddleDragOrbit", () => {
  const jumpTo = jest.fn();
  const setDragPanEnabled = jest.fn();
  const onInteractionStart = jest.fn();
  let canvas: HTMLDivElement;
  let dragPanEnabled = true;

  beforeEach(() => {
    jumpTo.mockClear();
    setDragPanEnabled.mockClear();
    onInteractionStart.mockClear();
    canvas = document.createElement("div");
    dragPanEnabled = true;
    currentMap = {
      getGestureSurface: () => canvas,
      isDragPanEnabled: () => dragPanEnabled,
      setDragPanEnabled,
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
    expect(setDragPanEnabled).toHaveBeenCalledWith(false);
    expect(canvas.className).toContain("orbiting");

    window.dispatchEvent(pointerEvent("pointermove", { pointerId: 8, clientX: 20, clientY: 30 }));
    expect(jumpTo).not.toHaveBeenCalled();
    const move = pointerEvent("pointermove", { pointerId: 7, clientX: 20, clientY: 30 });
    window.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
    expect(jumpTo).toHaveBeenCalledWith({ bearing: 13.5, pitch: 17.5 });

    window.dispatchEvent(pointerEvent("pointerup", { pointerId: 8 }));
    expect(setDragPanEnabled).not.toHaveBeenCalledWith(true);
    window.dispatchEvent(pointerEvent("pointerup", { pointerId: 7 }));
    expect(setDragPanEnabled).toHaveBeenCalledWith(true);
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
    expect(setDragPanEnabled).not.toHaveBeenCalledWith(false);
    view.unmount();
    expect(setDragPanEnabled).not.toHaveBeenCalledWith(true);
    expect(canvas.className).not.toContain("orbiting");
  });

  it("waits for a map instance", () => {
    currentMap = null;
    render(<MapMiddleDragOrbit onInteractionStart={onInteractionStart} />);
    expect(onInteractionStart).not.toHaveBeenCalled();
  });
});
