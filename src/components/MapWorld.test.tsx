/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Profiler, type ReactNode } from "react";
import type { MapWorldEntry } from "../util/pageDataTypes";

const mapHandlers: {
  onMoveStart?:
    | ((event: { viewState: { latitude: number; longitude: number; zoom: number } }) => void)
    | undefined;
  onClick?:
    | ((event: {
        lngLat: { lat: number; lng: number };
        point: { x: number; y: number };
        originalEvent: MouseEvent;
      }) => void)
    | undefined;
  onMoveEnd?:
    | ((event: { viewState: { latitude: number; longitude: number; zoom: number } }) => void)
    | undefined;
  onZoomStart?:
    | ((event: { viewState: { latitude: number; longitude: number; zoom: number } }) => void)
    | undefined;
  onZoomEnd?:
    | ((event: { viewState: { latitude: number; longitude: number; zoom: number } }) => void)
    | undefined;
  onZoom?: ((event: { viewState: { zoom: number } }) => void) | undefined;
  onDragStart?:
    | ((event: { viewState: { latitude: number; longitude: number; zoom: number } }) => void)
    | undefined;
  onWheel?: ((event: { originalEvent: WheelEvent }) => void) | undefined;
  onContextMenu?:
    | ((event: {
        lngLat: { lat: number; lng: number };
        point: { x: number; y: number };
        originalEvent: { preventDefault: () => void };
      }) => void)
    | undefined;
} = {};
const mapProps = jest.fn();
const layerProps = new Map<string, { paint?: Record<string, unknown> }>();
/** The popups the provider would close on the next map click. */
const popupCloseOnMapClick = new Set<() => void>();

const mapCanvas = document.createElement("div");
const mapInstance = {
  flyTo: jest.fn(),
  stop: jest.fn(),
  jumpTo: jest.fn(),
  getBearing: jest.fn(() => 10),
  getPitch: jest.fn(() => 20),
  getCanvasContainer: jest.fn(() => mapCanvas),
  getContainer: jest.fn(() => mapCanvas),
  dragPan: {
    isEnabled: jest.fn(() => true),
    disable: jest.fn(),
    enable: jest.fn(),
  },
  on: jest.fn(),
  off: jest.fn(),
  // Stacking: the port raises each declared group in turn, skipping any layer
  // the style does not currently hold.
  getLayer: jest.fn(() => ({})),
  // Reported as empty so the port never mistakes this double for a style that
  // already holds the declared stack, and the moves it wants are all visible.
  getLayersOrder: jest.fn(() => []),
  moveLayer: jest.fn(),
  project: jest.fn(([longitude, latitude]: [number, number]) => ({
    x: longitude * 100,
    y: latitude * 100,
  })),
  getBounds: jest.fn(() => ({
    getNorth: () => 90,
    getSouth: () => -90,
    getEast: () => 180,
    getWest: () => -180,
  })),
};

const mapRef = { current: mapInstance };
jest.mock("./map/adapters/maplibre", () => {
  return {
    __esModule: true,
    default: ({
      children,
      onMoveStart,
      onClick,
      onMoveEnd,
      onZoomStart,
      onZoomEnd,
      onZoom,
      onDragStart,
      onWheel,
      onContextMenu,
      ...props
    }: {
      children?: ReactNode;
      onMoveStart?: (event: {
        viewState: { latitude: number; longitude: number; zoom: number };
      }) => void;
      onClick?: (event: {
        lngLat: { lat: number; lng: number };
        point: { x: number; y: number };
        originalEvent: MouseEvent;
      }) => void;
      onMoveEnd?: (event: {
        viewState: { latitude: number; longitude: number; zoom: number };
      }) => void;
      onZoomStart?: (event: {
        viewState: { latitude: number; longitude: number; zoom: number };
      }) => void;
      onZoomEnd?: (event: {
        viewState: { latitude: number; longitude: number; zoom: number };
      }) => void;
      onZoom?: (event: { viewState: { zoom: number } }) => void;
      onDragStart?: (event: {
        viewState: { latitude: number; longitude: number; zoom: number };
      }) => void;
      onWheel?: (event: { originalEvent: WheelEvent }) => void;
      onContextMenu?: (event: {
        lngLat: { lat: number; lng: number };
        point: { x: number; y: number };
        originalEvent: { preventDefault: () => void };
      }) => void;
      [key: string]: unknown;
    }) => {
      mapHandlers.onMoveStart = onMoveStart;
      mapHandlers.onClick = onClick;
      mapHandlers.onMoveEnd = onMoveEnd;
      mapHandlers.onZoomStart = onZoomStart;
      mapHandlers.onZoomEnd = onZoomEnd;
      mapHandlers.onZoom = onZoom;
      mapHandlers.onDragStart = onDragStart;
      mapHandlers.onWheel = onWheel;
      mapHandlers.onContextMenu = onContextMenu;
      mapProps(props);
      return <div data-testid="map">{children}</div>;
    },
    Marker: ({
      children,
      onClick,
    }: {
      children?: ReactNode;
      onClick?: (event: { originalEvent: { stopPropagation: () => void } }) => void;
    }) => (
      <button
        type="button"
        data-testid="marker"
        onClick={() => {
          onClick?.({ originalEvent: { stopPropagation: jest.fn() } });
        }}
      >
        {children}
      </button>
    ),
    Popup: ({
      children,
      className,
      onClose,
      closeOnClick,
    }: {
      children?: ReactNode;
      className?: string;
      onClose?: () => void;
      closeOnClick?: boolean;
    }) => {
      const { useEffect } = require("react") as typeof import("react");
      // MapLibre shuts a popup on the next map click unless told otherwise, and
      // that default is the whole difficulty: a pin's click and the map's click
      // are one gesture, so a popup opened by that click would report itself
      // dismissed before the reader ever saw it. Modelled here so the map's own
      // dismissal is tested against the provider's behaviour, not around it.
      useEffect(() => {
        if (closeOnClick === false || !onClose) {
          return;
        }

        popupCloseOnMapClick.add(onClose);

        return () => {
          popupCloseOnMapClick.delete(onClose);
        };
      }, [closeOnClick, onClose]);

      return (
        <div data-testid="popup" className={className}>
          {children}
          <button type="button" aria-label="Close popup" onClick={onClose} />
        </div>
      );
    },
    ScaleControl: () => null,
    NavigationControl: () => null,
    GeolocateControl: () => null,
    FullscreenControl: () => null,
    Source: ({ children, id, data }: { children?: ReactNode; id?: string; data?: unknown }) => (
      <div data-testid={id ?? "source"} data-source={JSON.stringify(data)}>
        {children}
      </div>
    ),
    Layer: ({ id, ...props }: { id?: string; paint?: Record<string, unknown> }) => {
      layerProps.set(id ?? "layer", props);
      return <div data-testid={id ?? "layer"} />;
    },
    useMap: () => mapRef,
    // The port restacks whenever the enclosing source re-adds its layers; this
    // fake source never rebuilds, so it never reports one.
    useSourceGeneration: () => 0,
  };
});

/**
 * Away from the marker-image zoom the photo pins are one GPU layer rather than a
 * DOM node each, so a pin is picked the way the map picks one: by the layer's
 * own listener reporting the feature under the pointer.
 */
const PIN_LAYER_ID = "photo-markers-point-circles";

/**
 * The journey line is handed to the map as data rather than as a style, so the
 * port owns the source and layer names: one line layer per dash pattern, and the
 * single-album route is the dashed one.
 */
const JOURNEY_SOURCE_ID = "journey-line-lines";
const JOURNEY_GLOW_SOURCE_ID = "journey-line-glow-lines";
const JOURNEY_LAYER_ID = "journey-line-line-strokes";
const JOURNEY_DASHED_LAYER_ID = "journey-line-line-strokes-2-2";
const JOURNEY_GLOW_LAYER_ID = "journey-line-glow-line-strokes";

type JourneyLineProperties = {
  id: string;
  color: string;
  width: number;
  opacity?: number;
};

const journeyLineProperties = (sourceId: string): JourneyLineProperties[] => {
  const source = screen.getByTestId(sourceId).dataset.source;
  const data = JSON.parse(source ?? "{}") as {
    features?: { properties: JourneyLineProperties }[];
  };

  return (data.features ?? []).map((feature) => feature.properties);
};

type PinLayerEvent = {
  lngLat: { lng: number; lat: number };
  features: { properties: { id: string } }[];
};
type PinLayerListener = (event: PinLayerEvent) => void;

const pinLayerListener = (type: "click" | "mousemove"): PinLayerListener => {
  const calls = mapInstance.on.mock.calls as unknown as [string, string, PinLayerListener][];
  const listener = calls
    .filter(([event, layerId]) => event === type && layerId === PIN_LAYER_ID)
    .at(-1)?.[2];

  if (!listener) {
    throw new Error(`No "${type}" listener is registered on ${PIN_LAYER_ID}`);
  }

  return listener;
};

/**
 * Everything one click on the map surface sets off, in the order a real map
 * does it: the map's own click event, then the layer reporting whatever feature
 * was under the pointer, then the provider shutting the popups that were
 * already open, and finally the click reaching the gesture surface — which is
 * where the application gets to decide whether the click landed on anything.
 */
const clickGesture = (at: { lng: number; lat: number }, hitPin?: () => void) => {
  const alreadyOpen = [...popupCloseOnMapClick];
  act(() => {
    fireEvent(mapCanvas, new MouseEvent("pointerdown"));
  });
  act(() => {
    mapHandlers.onClick?.({
      lngLat: at,
      point: { x: 0, y: 0 },
      originalEvent: new MouseEvent("click"),
    });
    hitPin?.();
    alreadyOpen.forEach((close) => {
      close();
    });
  });
  act(() => {
    fireEvent.click(mapCanvas);
  });
};

const clickPin = (photo: MapWorldEntry) => {
  clickGesture({ lng: photo.decLng ?? 0, lat: photo.decLat ?? 0 }, () => {
    pinLayerListener("click")({
      lngLat: { lng: photo.decLng ?? 0, lat: photo.decLat ?? 0 },
      features: [{ properties: { id: photo.href } }],
    });
  });
};

/** A click that lands on the basemap and nothing else. */
const clickEmptyMap = () => {
  clickGesture({ lng: 0, lat: 0 });
};

const hoverPin = (photo: MapWorldEntry) => {
  act(() => {
    pinLayerListener("mousemove")({
      lngLat: { lng: photo.decLng ?? 0, lat: photo.decLat ?? 0 },
      features: [{ properties: { id: photo.href } }],
    });
  });
};

/** The layers the port has restacked, in the order it moved them. */
const restackedLayers = (): string[] =>
  (mapInstance.moveLayer.mock.calls as unknown as [string][]).map(([layerId]) => layerId);

jest.mock("usehooks-ts", () => ({
  useIntersectionObserver: () => ({
    entry: { isIntersecting: true },
    ref: jest.fn(),
  }),
}));

jest.mock("./ThemeToggle", () => ({
  ThemeToggle: () => <span data-testid="theme-bootstrap" />,
}));

jest.mock("../util/time", () => ({
  getRelativeTimeString: () => "just now",
}));

const { mapStyleUrl, resetMapStyleCache, setMapStyleName } =
  require("../util/mapStyles") as typeof import("../util/mapStyles");

const mapWorldModule = require("./MapWorld");
const { MMap } = mapWorldModule;

describe("MapWorld", () => {
  const photo: MapWorldEntry = {
    album: "kansai",
    src: { src: "/photo.jpg", width: 100, height: 100 },
    decLat: 35.6762,
    decLng: 139.6503,
    date: "2024-01-02T03:04:05.000Z",
    href: "/album/kansai#photo.jpg",
    placeholderColor: "transparent",
    placeholderWidth: 100,
    placeholderHeight: 100,
  };

  let replaceStateSpy: jest.SpyInstance;
  const originalMatchMedia = window.matchMedia;

  /**
   * A media-query list shaped the way a browser's is — subscribable, and
   * answering every query the same way. Assigning a bare `{ matches }` leaks
   * into every case that runs afterwards and leaves `addEventListener` missing
   * for anything that tries to follow the query.
   */
  const stubMatchMedia = (matches: boolean) => {
    window.matchMedia = jest.fn((media: string) => ({
      matches,
      media,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })) as unknown as typeof window.matchMedia;
  };

  beforeEach(() => {
    window.localStorage.clear();
    resetMapStyleCache();
    window.history.replaceState({}, "", "/");
    jest.useFakeTimers();
    mapHandlers.onMoveStart = undefined;
    mapHandlers.onClick = undefined;
    mapHandlers.onMoveEnd = undefined;
    mapHandlers.onZoomStart = undefined;
    mapHandlers.onZoomEnd = undefined;
    mapHandlers.onZoom = undefined;
    mapHandlers.onDragStart = undefined;
    mapHandlers.onWheel = undefined;
    mapHandlers.onContextMenu = undefined;
    mapProps.mockClear();
    layerProps.clear();
    mapInstance.flyTo.mockClear();
    mapInstance.stop.mockClear();
    mapInstance.on.mockClear();
    mapInstance.off.mockClear();
    mapInstance.project.mockClear();
    mapInstance.getBounds.mockClear();
    mapInstance.jumpTo.mockClear();
    mapInstance.moveLayer.mockClear();
    popupCloseOnMapClick.clear();
    mapInstance.dragPan.disable.mockClear();
    mapInstance.dragPan.enable.mockClear();
    replaceStateSpy = jest.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    replaceStateSpy.mockRestore();
    window.matchMedia = originalMatchMedia;
  });

  it("updates the URL with debounced next router replace", () => {
    render(<MMap photos={[photo]} className="map" />);

    act(() => {
      mapHandlers.onMoveEnd?.({
        viewState: { latitude: 35.6762, longitude: 139.6503, zoom: 14 },
      });
    });

    expect(replaceStateSpy).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/?lat=35.676&lon=139.650&zoom=14.00",
    );
  });

  it("merges a pending camera update into the latest URL state", () => {
    window.history.pushState({}, "", "/?from=2020-01-01&to=2025-01-01");
    render(<MMap photos={[photo]} className="map" />);

    act(() => {
      mapHandlers.onMoveEnd?.({
        viewState: { latitude: 35.6762, longitude: 139.6503, zoom: 14 },
      });
    });

    // A different control clears its params while camera sync is pending.
    window.history.pushState({}, "", "/?filter_album=kansai");

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/?filter_album=kansai&lat=35.676&lon=139.650&zoom=14.00",
    );
  });

  it("pauses router sync while popup links are being clicked", () => {
    render(<MMap photos={[photo]} className="map" />);

    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 9 } });
    });

    fireEvent.click(screen.getByTestId("marker"));
    fireEvent.mouseDown(screen.getByRole("link", { name: /kansai/i }));

    act(() => {
      mapHandlers.onMoveEnd?.({
        viewState: { latitude: 35.6762, longitude: 139.6503, zoom: 14 },
      });
    });

    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(replaceStateSpy).not.toHaveBeenCalled();

    expect(screen.getByRole("link", { name: /kansai/i }).getAttribute("href")).toBe(
      "/album/kansai#photo.jpg",
    );
    expect(screen.getByTestId("popup").className).toContain("click");
  });

  it("opens external map actions for a right-clicked coordinate", () => {
    const preventDefault = jest.fn();
    render(<MMap photos={[photo]} className="map" />);

    act(() => {
      mapHandlers.onContextMenu?.({
        lngLat: { lat: 22.3193, lng: 114.1694 },
        point: { x: 10, y: 20 },
        originalEvent: { preventDefault },
      });
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Location actions" })).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Google Maps/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=22.3193%2C114.1694",
    );
    expect(screen.getByRole("link", { name: /OpenStreetMap/ })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/?mlat=22.3193&mlon=114.1694&zoom=13",
    );
  });

  it("orbits the camera while the middle pointer button is dragged", () => {
    render(<MMap photos={[photo]} className="map" />);

    fireEvent(mapCanvas, new MouseEvent("pointerdown", { button: 1, clientX: 100, clientY: 100 }));
    fireEvent(window, new MouseEvent("pointermove", { clientX: 120, clientY: 80 }));
    fireEvent(window, new MouseEvent("pointerup"));

    expect(mapInstance.dragPan.disable).toHaveBeenCalled();
    expect(mapInstance.jumpTo).toHaveBeenCalledWith({ bearing: 17, pitch: 25 });
    expect(mapInstance.dragPan.enable).toHaveBeenCalled();
  });

  it("tours the current photo pool while the caller enables it", () => {
    // Nothing asks for reduced motion, so the tour actually flies.
    stubMatchMedia(false);
    const london = {
      ...photo,
      album: "london",
      href: "/album/london#photo.jpg",
      decLat: 51.5,
      decLng: -0.1,
      date: "2023-01-01T00:00:00",
    };
    const onDirectorEnabledChange = jest.fn();
    const onDirectorSequenceLengthChange = jest.fn();
    const { rerender } = render(
      <MMap
        photos={[london, photo]}
        className="map"
        directorEnabled
        onDirectorEnabledChange={onDirectorEnabledChange}
        onDirectorSequenceLengthChange={onDirectorSequenceLengthChange}
      />,
    );

    // The trigger lives outside the map, so the caller needs the tour length to
    // decide whether offering it makes sense at all.
    expect(onDirectorSequenceLengthChange).toHaveBeenCalledWith(2);
    expect(mapInstance.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [139.6503, 35.6762], pitch: 42 }),
    );

    rerender(
      <MMap
        photos={[london, photo]}
        className="map"
        directorEnabled={false}
        onDirectorEnabledChange={onDirectorEnabledChange}
        onDirectorSequenceLengthChange={onDirectorSequenceLengthChange}
      />,
    );
    expect(mapInstance.stop).toHaveBeenCalled();
  });

  it("tells the caller to stop when the pool shrinks below a tour", () => {
    // Filtering down to one photo leaves nothing to tour. An external control
    // would still read as playing unless the map reports the change back.
    stubMatchMedia(false);
    const london = {
      ...photo,
      album: "london",
      href: "/album/london#photo.jpg",
      decLat: 51.5,
      decLng: -0.1,
      date: "2023-01-01T00:00:00",
    };
    const onDirectorEnabledChange = jest.fn();
    const onDirectorSequenceLengthChange = jest.fn();
    const { rerender } = render(
      <MMap
        photos={[london, photo]}
        className="map"
        directorEnabled
        onDirectorEnabledChange={onDirectorEnabledChange}
        onDirectorSequenceLengthChange={onDirectorSequenceLengthChange}
      />,
    );
    onDirectorEnabledChange.mockClear();

    rerender(
      <MMap
        photos={[photo]}
        className="map"
        directorEnabled
        onDirectorEnabledChange={onDirectorEnabledChange}
        onDirectorSequenceLengthChange={onDirectorSequenceLengthChange}
      />,
    );

    expect(onDirectorSequenceLengthChange).toHaveBeenLastCalledWith(1);
    expect(onDirectorEnabledChange).toHaveBeenCalledWith(false);
  });

  it("only rerenders when zoom crosses the marker-image threshold", () => {
    const onRender = jest.fn();
    render(
      <Profiler id="map" onRender={onRender}>
        <MMap photos={[photo]} className="map" />
      </Profiler>,
    );

    const initialRenderCount = onRender.mock.calls.length;

    // A crossing costs renders — the marker path changes, and the markers are
    // admitted over several of them. What must cost nothing is a zoom that
    // stays on one side of it: `onZoom` fires every frame of every gesture.
    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 9 } });
    });
    expect(onRender.mock.calls.length).toBeGreaterThan(initialRenderCount);
    const afterReveal = onRender.mock.calls.length;

    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 10 } });
      mapHandlers.onZoom?.({ viewState: { zoom: 9.5 } });
    });
    expect(onRender).toHaveBeenCalledTimes(afterReveal);

    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 8 } });
    });
    expect(onRender.mock.calls.length).toBeGreaterThan(afterReveal);
    const afterHide = onRender.mock.calls.length;

    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 7 } });
    });
    expect(onRender).toHaveBeenCalledTimes(afterHide);
  });

  it("draws the basemap the reader picked, from the same provider as the default", () => {
    // The picker writes the preference; the map is a different subtree, and a
    // localStorage write raises no event in its own tab — so the store has to
    // tell it directly or the choice does nothing until a reload.
    render(<MMap photos={[photo]} className="map" />);
    expect(mapProps).toHaveBeenLastCalledWith(
      // The port hands the adapter its own `mapStyle`; `styleUrl` is the neutral
      // name on the way in.
      expect.objectContaining({ mapStyle: mapStyleUrl("gallery") }),
    );

    act(() => {
      setMapStyleName("watercolour");
    });
    expect(mapProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ mapStyle: mapStyleUrl("watercolour") }),
    );
    expect(mapStyleUrl("watercolour")).toContain("api.maptiler.com");
  });

  it("keeps the thumbnails through a wobble back below the reveal zoom", () => {
    render(<MMap photos={[photo]} className="map" />);
    expect(screen.queryAllByTestId("marker")).toHaveLength(0);

    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 8.6 } });
    });
    expect(screen.queryAllByTestId("marker")).toHaveLength(1);

    // A pinch settling just under the reveal zoom must not swap the entire
    // marker path back to the drawn pins and then forwards again.
    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 8.3 } });
    });
    expect(screen.queryAllByTestId("marker")).toHaveLength(1);

    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 8.1 } });
    });
    expect(screen.queryAllByTestId("marker")).toHaveLength(0);
  });

  it("fetches the thumbnails before the zoom that reveals them", () => {
    const requested: string[] = [];
    const realImage = window.Image;
    class RecordingImage {
      decoding = "";
      fetchPriority = "";
      addEventListener() {}
      set src(value: string) {
        requested.push(value);
      }
    }
    Object.defineProperty(window, "Image", { configurable: true, value: RecordingImage });

    try {
      render(<MMap photos={[photo]} className="map" />);
      expect(requested).toEqual([]);

      // Still the drawn pins at this zoom — but close enough that the images
      // should be on their way, so the reveal lands on a decoded photo.
      act(() => {
        mapHandlers.onZoom?.({ viewState: { zoom: 8.3 } });
      });
      expect(screen.queryAllByTestId("marker")).toHaveLength(0);
      expect(requested).toEqual(["/photo.jpg"]);
    } finally {
      Object.defineProperty(window, "Image", { configurable: true, value: realImage });
    }
  });

  it("renders a journey line layer when enabled", () => {
    render(
      <MMap
        photos={[
          photo,
          {
            ...photo,
            href: "/album/kansai#two.jpg",
            src: { src: "/photo-2.jpg", width: 100, height: 100 },
            decLat: 35.8,
            decLng: 139.8,
          },
        ]}
        className="map"
        showRoute
        routeDisplayMode="always"
      />,
    );

    expect(screen.getByTestId(JOURNEY_SOURCE_ID)).toBeTruthy();
    expect(screen.getByTestId(JOURNEY_DASHED_LAYER_ID)).toBeTruthy();
    expect(screen.getByTestId("journey-line-overlay")).toBeTruthy();
  });

  it("reveals a context path for the selected marker without always-on route mode", () => {
    render(
      <MMap
        photos={[
          photo,
          {
            ...photo,
            href: "/album/kansai#two.jpg",
            src: { src: "/photo-2.jpg", width: 100, height: 100 },
            decLat: 36.8,
            decLng: 140.8,
            date: "2024-01-02T06:14:05.000Z",
          },
        ]}
        className="map"
      />,
    );

    expect(screen.queryByTestId(JOURNEY_SOURCE_ID)).toBeNull();

    clickPin(photo);

    expect(screen.getByTestId(JOURNEY_SOURCE_ID)).toBeTruthy();
    expect(screen.getByTestId(JOURNEY_DASHED_LAYER_ID)).toBeTruthy();
    expect(screen.getByTestId("journey-line-overlay")).toBeTruthy();
    expect(screen.getByTestId("journey-line-speed-label")).toBeTruthy();
  });

  it("draws a Pacific-crossing route leg the short way across the antimeridian", () => {
    // project() is mocked as x = lng * 100, so an unwrapped end longitude of
    // 190 (the short way from 170 to -170) projects to x = 19000, whereas the
    // naive -170 would project to x = -17000 (the long way round).
    render(
      <MMap
        photos={[
          {
            ...photo,
            href: "/album/pacific#a.jpg",
            decLat: 10,
            decLng: 170,
            date: "2024-01-01T00:00:00.000Z",
          },
          {
            ...photo,
            href: "/album/pacific#b.jpg",
            src: { src: "/photo-2.jpg", width: 100, height: 100 },
            decLat: 20,
            decLng: -170,
            date: "2024-01-02T00:00:00.000Z",
          },
        ]}
        className="map"
        showRoute
        routeDisplayMode="always"
      />,
    );

    const segment = screen.getAllByTestId("journey-line-segment")[0]!;
    const d = segment.getAttribute("d") ?? "";
    // End x is the unwrapped 190 -> 19000, positive and just east of the start.
    expect(d).toContain("19000.00");
    expect(d).not.toContain("-17000");
  });

  it("colours markers without NaN for an all-same-timestamp burst", () => {
    const { container } = render(
      <MMap
        photos={[
          { ...photo, href: "/album/kansai#a.jpg", date: "2024-01-02T03:04:05.000Z" },
          {
            ...photo,
            href: "/album/kansai#b.jpg",
            src: { src: "/photo-2.jpg", width: 100, height: 100 },
            decLat: 35.7,
            decLng: 139.7,
            date: "2024-01-02T03:04:05.000Z",
          },
        ]}
        className="map"
      />,
    );

    // range === 0 previously produced hsl(NaN,…) / hue-rotate(NaNdeg).
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("keeps album routes interactive when the full journey line is enabled", () => {
    render(
      <MMap
        photos={[
          photo,
          {
            ...photo,
            href: "/album/kansai#two.jpg",
            src: { src: "/photo-2.jpg", width: 100, height: 100 },
            decLat: 35.5,
            decLng: 139.5,
            date: "2024-01-02T06:14:05.000Z",
          },
          {
            ...photo,
            href: "/album/kansai#three.jpg",
            src: { src: "/photo-3.jpg", width: 100, height: 100 },
            decLat: 36.1,
            decLng: 140.2,
            date: "2024-02-11T06:14:05.000Z",
          },
        ]}
        className="map"
        showRoute
        routeDisplayMode="always"
      />,
    );

    hoverPin(photo);

    expect(screen.getByTestId("journey-line-overlay")).toBeTruthy();
    expect(screen.getByTestId("journey-line-ghost-route")).toBeTruthy();
    expect(screen.getByTestId("journey-line-speed-label")).toBeTruthy();
  });

  it("hydrates the camera from the URL and honours presentation options", () => {
    window.history.pushState({}, "", "/?lon=12.5&lat=-3.25&zoom=9.5");
    render(
      <MMap
        photos={[photo]}
        className="custom-map"
        style={{ minHeight: 240 }}
        showThemeBootstrap={false}
        fitToPhotos
      />,
    );

    expect(mapWorldModule.default).toBe(MMap);
    expect(mapProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialViewState: { longitude: 12.5, latitude: -3.25, zoom: 9.5 },
      }),
    );
    expect(screen.getByTestId("map").parentElement).toHaveStyle({ minHeight: "240px" });
    expect(screen.queryByTestId("theme-bootstrap")).toBeNull();
    expect(screen.getByTestId("marker")).toBeInTheDocument();
  });

  it("ignores camera and popup sync when route synchronisation is disabled", () => {
    window.history.pushState({}, "", "/?lon=12.5&lat=-3.25&zoom=9.5");
    render(<MMap photos={[photo]} className="map" syncRoute={false} />);
    expect(mapProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialViewState: { longitude: undefined, latitude: undefined, zoom: undefined },
      }),
    );

    clickPin(photo);
    fireEvent.mouseDown(screen.getByRole("link", { name: /kansai/i }));
    act(() => {
      mapHandlers.onMoveEnd?.({
        viewState: { latitude: 1, longitude: 2, zoom: 3 },
      });
      mapHandlers.onZoomEnd?.({
        viewState: { latitude: 4, longitude: 5, zoom: 6 },
      });
      jest.runAllTimers();
    });
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("deduplicates camera routes, replaces pending updates, and clears pending work on unmount", () => {
    const view = render(<MMap photos={[photo]} className="map" />);
    act(() => {
      mapHandlers.onMoveEnd?.({ viewState: { latitude: 1, longitude: 2, zoom: 3 } });
      mapHandlers.onMoveEnd?.({ viewState: { latitude: 4, longitude: 5, zoom: 6 } });
      jest.advanceTimersByTime(200);
    });
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);

    act(() => {
      mapHandlers.onZoomEnd?.({ viewState: { latitude: 4, longitude: 5, zoom: 6 } });
      jest.advanceTimersByTime(200);
    });
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);

    act(() => {
      mapHandlers.onMoveEnd?.({ viewState: { latitude: 7, longitude: 8, zoom: 9 } });
    });
    view.unmount();
    act(() => {
      jest.runAllTimers();
    });
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
  });

  it("closes menus on map interaction and hides route overlays while moving", () => {
    const second = {
      ...photo,
      href: "/album/kansai#second.jpg",
      decLat: 36,
      decLng: 140,
      date: "2024-02-02T03:04:05.000Z",
    };
    render(<MMap photos={[photo, second]} className="map" showRoute routeDisplayMode="always" />);
    expect(screen.getByTestId("journey-line-overlay")).toBeInTheDocument();

    act(() => mapHandlers.onZoomStart?.({ viewState: { latitude: 1, longitude: 2, zoom: 3 } }));
    expect(screen.queryByTestId("journey-line-overlay")).toBeNull();
    act(() => mapHandlers.onZoomEnd?.({ viewState: { latitude: 1, longitude: 2, zoom: 3 } }));
    expect(screen.getByTestId("journey-line-overlay")).toBeInTheDocument();

    act(() =>
      mapHandlers.onContextMenu?.({
        lngLat: { lat: 1, lng: 2 },
        point: { x: 3, y: 4 },
        originalEvent: { preventDefault: jest.fn() },
      }),
    );
    expect(screen.getByRole("group", { name: "Location actions" })).toBeInTheDocument();
    clickEmptyMap();
    expect(screen.queryByRole("group", { name: "Location actions" })).toBeNull();

    act(() =>
      mapHandlers.onContextMenu?.({
        lngLat: { lat: 1, lng: 2 },
        point: { x: 3, y: 4 },
        originalEvent: { preventDefault: jest.fn() },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close popup" }));
    expect(screen.queryByRole("group", { name: "Location actions" })).toBeNull();

    act(() => mapHandlers.onMoveStart?.({ viewState: { latitude: 1, longitude: 2, zoom: 3 } }));
    expect(screen.queryByTestId("journey-line-overlay")).toBeNull();
    act(() => mapHandlers.onDragStart?.({ viewState: { latitude: 1, longitude: 2, zoom: 3 } }));
    act(() => mapHandlers.onWheel?.({ originalEvent: new WheelEvent("wheel") }));
  });

  it("opens the selected photo's popup from the same tap the map also hears", () => {
    // A pin's click and the map's click are one gesture. The map reports the
    // feature under the pointer, the provider offers to shut whatever popup was
    // open, and the click then reaches the surface — all before the reader has
    // let go. Any of those steps clearing the selection loses the selected
    // popup, and with it the external map links and the route emphasis.
    render(
      <MMap
        photos={[
          photo,
          {
            ...photo,
            href: "/album/kansai#two.jpg",
            src: { src: "/photo-2.jpg", width: 100, height: 100 },
            decLat: 36.8,
            decLng: 140.8,
            date: "2024-01-02T06:14:05.000Z",
          },
        ]}
        className="map"
      />,
    );

    // Moving onto the pin first is the ordinary desktop path, and it is what
    // leaves a popup open for the click to shut.
    hoverPin(photo);
    clickPin(photo);

    expect(screen.getByRole("link", { name: /kansai/i })).toHaveAttribute("href", photo.href);
    expect(screen.getByTestId("popup").className).toContain("click");
    expect(screen.getByRole("link", { name: /Google Maps/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /OpenStreetMap/ })).toBeInTheDocument();
    // The selection is what emphasises the photo's own journey.
    expect(screen.getByTestId("journey-line-overlay")).toBeInTheDocument();
  });

  it("keeps the location menu open when the next click lands on a pin", () => {
    render(<MMap photos={[photo]} className="map" />);

    act(() =>
      mapHandlers.onContextMenu?.({
        lngLat: { lat: 1, lng: 2 },
        point: { x: 3, y: 4 },
        originalEvent: { preventDefault: jest.fn() },
      }),
    );
    expect(screen.getByRole("group", { name: "Location actions" })).toBeInTheDocument();

    clickPin(photo);
    expect(screen.getByRole("group", { name: "Location actions" })).toBeInTheDocument();

    // Only a click that lands on nothing puts the map's overlays away.
    clickEmptyMap();
    expect(screen.queryByRole("group", { name: "Location actions" })).toBeNull();
    expect(screen.queryByRole("link", { name: /kansai/i })).toBeNull();
  });

  it("still dismisses on a click that follows a pin click the surface never heard", () => {
    render(<MMap photos={[photo]} className="map" />);

    act(() =>
      mapHandlers.onContextMenu?.({
        lngLat: { lat: 1, lng: 2 },
        point: { x: 3, y: 4 },
        originalEvent: { preventDefault: jest.fn() },
      }),
    );
    expect(screen.getByRole("group", { name: "Location actions" })).toBeInTheDocument();

    // Zoomed past the marker-image threshold the pins are DOM markers, and a
    // marker stops its click at its own element: the gesture surface never
    // hears it, so the claim that click leaves behind is never spent.
    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 9 } });
    });
    fireEvent.click(screen.getByTestId("marker"));
    expect(screen.getByRole("group", { name: "Location actions" })).toBeInTheDocument();

    // Each gesture has to open with a clean slate, or this one is spent
    // clearing the stale claim instead of dismissing, and the reader has to
    // click a second time to put the map's overlays away.
    clickEmptyMap();

    expect(screen.queryByRole("group", { name: "Location actions" })).toBeNull();
  });

  it("puts a hover-opened popup away with the click that lands on nothing", () => {
    render(<MMap photos={[photo]} className="map" />);

    hoverPin(photo);
    expect(screen.getByRole("link", { name: /kansai/i })).toBeInTheDocument();

    // A mouse leaving a pin reports it, so this is unreachable with one; an
    // emulated mouse — a tap on a touch browser — sends no leave at all, and
    // without clearing the hover the dismissed popup simply stays put, fed by a
    // hover nothing is ever going to clear.
    clickEmptyMap();
    expect(screen.queryByRole("link", { name: /kansai/i })).toBeNull();
  });

  it("keeps the photo pins above the journey lines a selection brings back", () => {
    render(
      <MMap
        photos={[
          photo,
          {
            ...photo,
            href: "/album/kansai#two.jpg",
            src: { src: "/photo-2.jpg", width: 100, height: 100 },
            decLat: 36.8,
            decLng: 140.8,
            date: "2024-01-02T06:14:05.000Z",
          },
        ]}
        className="map"
      />,
    );

    // Selecting a pin mounts the journey lines, which a provider appends on top
    // of whatever is already drawn — burying the pins the reader is aiming at.
    clickPin(photo);

    const stack = restackedLayers();
    expect(stack.at(-1)).toBe(PIN_LAYER_ID);
    expect(stack.lastIndexOf(JOURNEY_DASHED_LAYER_ID)).toBeLessThan(
      stack.lastIndexOf(PIN_LAYER_ID),
    );
    expect(stack.lastIndexOf(JOURNEY_GLOW_LAYER_ID)).toBeLessThan(
      stack.lastIndexOf(JOURNEY_DASHED_LAYER_ID),
    );
  });

  it("cycles stacked photos and changes stacks from the current selection", () => {
    const stackOne = { ...photo, href: "/album/kansai#stack-one.jpg" };
    const stackTwo = {
      ...photo,
      href: "/album/kansai#stack-two.jpg",
      src: { src: "/two.jpg", width: 100, height: 100 },
    };
    const elsewhereOne = {
      ...photo,
      href: "/album/kansai#elsewhere-one.jpg",
      decLat: 40,
      decLng: 120,
    };
    const elsewhereTwo = {
      ...elsewhereOne,
      href: "/album/kansai#elsewhere-two.jpg",
      src: { src: "/four.jpg", width: 100, height: 100 },
    };
    render(<MMap photos={[stackOne, stackTwo, elsewhereOne, elsewhereTwo]} className="map" />);
    clickPin(stackOne);
    expect(screen.getByRole("link", { name: /kansai/i })).toHaveAttribute("href", stackOne.href);
    // A second tap on the same stack reaches the photo hidden beneath the first.
    clickPin(stackOne);
    expect(screen.getByRole("link", { name: /kansai/i })).toHaveAttribute("href", stackTwo.href);
    clickPin(elsewhereOne);
    expect(screen.getByRole("link", { name: /kansai/i })).toHaveAttribute(
      "href",
      elsewhereOne.href,
    );
    clickEmptyMap();
    expect(screen.queryByRole("link", { name: /kansai/i })).toBeNull();
  });

  it("filters selected and hovered photos when the time range changes", () => {
    const oldPhoto = {
      ...photo,
      href: "/album/kansai#old.jpg",
      date: "2020-01-02T03:04:05",
    };
    const recentPhoto = {
      ...photo,
      href: "/album/kansai#recent.jpg",
      decLat: 36,
      decLng: 140,
      date: "2024-01-02T03:04:05",
    };
    const view = render(<MMap photos={[oldPhoto, recentPhoto]} className="map" />);
    clickPin(oldPhoto);
    view.rerender(
      <MMap
        photos={[oldPhoto, recentPhoto]}
        className="map"
        timeRange={{ fromMs: new Date(2023, 0, 1).valueOf(), toMs: new Date(2025, 0, 1).valueOf() }}
      />,
    );
    expect(screen.queryByRole("link", { name: /kansai/i })).toBeNull();

    hoverPin(recentPhoto);
    expect(screen.getByRole("link", { name: /kansai/i })).toBeInTheDocument();
    view.rerender(
      <MMap
        photos={[oldPhoto, recentPhoto]}
        className="map"
        timeRange={{ fromMs: new Date(2019, 0, 1).valueOf(), toMs: new Date(2021, 0, 1).valueOf() }}
      />,
    );
    expect(screen.queryByRole("link", { name: /kansai/i })).toBeNull();
  });

  it("builds independently coloured journeys for multiple albums", () => {
    const photos = [
      { ...photo, href: "/album/a#one.jpg", album: "a" },
      {
        ...photo,
        href: "/album/a#two.jpg",
        album: "a",
        decLat: 36,
        decLng: 140,
        date: "2024-02-02T03:04:05",
      },
      {
        ...photo,
        href: "/album/b#one.jpg",
        album: "b",
        decLat: 50,
        decLng: 10,
        date: "2022-01-02T03:04:05",
      },
      {
        ...photo,
        href: "/album/b#two.jpg",
        album: "b",
        decLat: 51,
        decLng: 11,
        date: "2023-01-02T03:04:05",
      },
    ];
    const view = render(
      <MMap photos={photos} className="map" showRoute routeDisplayMode="always" />,
    );
    const lines = journeyLineProperties(JOURNEY_SOURCE_ID);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.id)).toEqual(["a", "b"]);
    expect(lines.map((line) => line.opacity)).toEqual([1, 1]);
    // Each album's journey carries its own colour rather than falling back to a
    // shared one, and the lines taper along their own length.
    const glow = journeyLineProperties(JOURNEY_GLOW_SOURCE_ID);
    expect(glow.map((line) => line.color)).toHaveLength(2);
    expect(glow[0]!.color).not.toEqual(glow[1]!.color);
    expect(layerProps.get(JOURNEY_LAYER_ID)?.paint?.["line-width"]).toEqual(
      expect.arrayContaining(["interpolate"]),
    );

    view.rerender(
      <MMap
        photos={photos}
        className="map"
        showRoute
        routeDisplayMode="always"
        routeMode="simplified"
      />,
    );
    expect(screen.getByTestId(JOURNEY_SOURCE_ID)).toBeInTheDocument();
  });

  it("omits empty routes and supports a simplified single-album route", () => {
    const unlocated = { ...photo, decLat: null, decLng: null };
    const view = render(
      <MMap
        photos={[unlocated, { ...unlocated, album: "other", href: "/album/other#a.jpg" }]}
        className="map"
        showRoute
        routeDisplayMode="always"
      />,
    );
    expect(screen.queryByTestId(JOURNEY_SOURCE_ID)).toBeNull();

    view.rerender(
      <MMap
        photos={[photo, { ...photo, href: "/album/kansai#two.jpg", decLat: 36, decLng: 140 }]}
        className="map"
        showRoute
        routeDisplayMode="always"
        routeMode="simplified"
      />,
    );
    expect(screen.getByTestId(JOURNEY_SOURCE_ID)).toBeInTheDocument();
    expect(journeyLineProperties(JOURNEY_SOURCE_ID)).toEqual([
      expect.objectContaining({ opacity: 0.55, width: 4 }),
    ]);
    expect(layerProps.get(JOURNEY_DASHED_LAYER_ID)?.paint).toEqual(
      expect.objectContaining({ "line-dasharray": [2, 2] }),
    );
  });
});
