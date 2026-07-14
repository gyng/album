/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Profiler, type ReactNode } from "react";
import { MapWorldEntry } from "./MapWorld";

const mapHandlers: {
  onMoveStart?: () => void;
  onClick?: () => void;
  onMoveEnd?: (event: { viewState: { latitude: number; longitude: number; zoom: number } }) => void;
  onZoomStart?: () => void;
  onZoomEnd?: (event: { viewState: { latitude: number; longitude: number; zoom: number } }) => void;
  onZoom?: (event: { viewState: { zoom: number } }) => void;
  onDragStart?: () => void;
  onWheel?: () => void;
  onContextMenu?: (event: {
    lngLat: { lat: number; lng: number };
    originalEvent: { preventDefault: () => void };
  }) => void;
} = {};
const mapProps = jest.fn();
const layerProps = new Map<string, { paint?: Record<string, unknown> }>();

const mapCanvas = document.createElement("div");
const mapInstance = {
  flyTo: jest.fn(),
  stop: jest.fn(),
  jumpTo: jest.fn(),
  getBearing: jest.fn(() => 10),
  getPitch: jest.fn(() => 20),
  getCanvasContainer: jest.fn(() => mapCanvas),
  dragPan: {
    isEnabled: jest.fn(() => true),
    disable: jest.fn(),
    enable: jest.fn(),
  },
  on: jest.fn(),
  off: jest.fn(),
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
jest.mock("react-map-gl/maplibre", () => {
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
      onMoveStart?: () => void;
      onClick?: () => void;
      onMoveEnd?: (event: {
        viewState: { latitude: number; longitude: number; zoom: number };
      }) => void;
      onZoomStart?: () => void;
      onZoomEnd?: (event: {
        viewState: { latitude: number; longitude: number; zoom: number };
      }) => void;
      onZoom?: (event: { viewState: { zoom: number } }) => void;
      onDragStart?: () => void;
      onWheel?: () => void;
      onContextMenu?: (event: {
        lngLat: { lat: number; lng: number };
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
    }: {
      children?: ReactNode;
      className?: string;
      onClose?: () => void;
    }) => (
      <div data-testid="popup" className={className}>
        {children}
        <button type="button" aria-label="Close popup" onClick={onClose} />
      </div>
    ),
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
  };
});

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

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

  beforeEach(() => {
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
    mapInstance.dragPan.disable.mockClear();
    mapInstance.dragPan.enable.mockClear();
    replaceStateSpy = jest.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    replaceStateSpy.mockRestore();
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

  it("directs the current photo pool and can be stopped", () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    const london = {
      ...photo,
      album: "london",
      href: "/album/london#photo.jpg",
      decLat: 51.5,
      decLng: -0.1,
      date: "2023-01-01T00:00:00",
    };
    const { rerender } = render(<MMap photos={[london, photo]} className="map" showDirector />);

    fireEvent.click(screen.getByRole("button", { name: /map tour/i }));

    expect(mapInstance.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [139.6503, 35.6762], pitch: 42 }),
    );
    expect(screen.getByRole("button", { name: /map tour/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: /map tour/i }));
    expect(mapInstance.stop).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /map tour/i }));
    rerender(<MMap photos={[photo]} className="map" showDirector />);
    expect(screen.queryByRole("button", { name: /map tour/i })).not.toBeInTheDocument();

    rerender(<MMap photos={[london, photo]} className="map" showDirector />);
    expect(screen.getByRole("button", { name: /map tour/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("only rerenders when zoom crosses the marker-image threshold", () => {
    const onRender = jest.fn();
    render(
      <Profiler id="map" onRender={onRender}>
        <MMap photos={[photo]} className="map" />
      </Profiler>,
    );

    const initialRenderCount = onRender.mock.calls.length;

    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 9 } });
    });
    expect(onRender).toHaveBeenCalledTimes(initialRenderCount + 1);

    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 10 } });
      mapHandlers.onZoom?.({ viewState: { zoom: 9.5 } });
    });
    expect(onRender).toHaveBeenCalledTimes(initialRenderCount + 1);

    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 8 } });
    });
    expect(onRender).toHaveBeenCalledTimes(initialRenderCount + 2);

    act(() => {
      mapHandlers.onZoom?.({ viewState: { zoom: 7 } });
    });
    expect(onRender).toHaveBeenCalledTimes(initialRenderCount + 2);
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

    expect(screen.getByTestId("journey-line-source")).toBeTruthy();
    expect(screen.getByTestId("journey-line-layer")).toBeTruthy();
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

    expect(screen.queryByTestId("journey-line-source")).toBeNull();

    fireEvent.click(screen.getAllByTestId("marker")[0]);

    expect(screen.getByTestId("journey-line-source")).toBeTruthy();
    expect(screen.getByTestId("journey-line-layer")).toBeTruthy();
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

    fireEvent.mouseOver(screen.getAllByTestId("marker")[0]!.querySelector("span")!);

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
        style: expect.objectContaining({ width: "100%", height: "100%", minHeight: 240 }),
      }),
    );
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

    fireEvent.click(screen.getByTestId("marker"));
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
    act(() => jest.runAllTimers());
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

    act(() => mapHandlers.onZoomStart?.());
    expect(screen.queryByTestId("journey-line-overlay")).toBeNull();
    act(() => mapHandlers.onZoomEnd?.({ viewState: { latitude: 1, longitude: 2, zoom: 3 } }));
    expect(screen.getByTestId("journey-line-overlay")).toBeInTheDocument();

    act(() =>
      mapHandlers.onContextMenu?.({
        lngLat: { lat: 1, lng: 2 },
        originalEvent: { preventDefault: jest.fn() },
      }),
    );
    expect(screen.getByRole("group", { name: "Location actions" })).toBeInTheDocument();
    act(() => mapHandlers.onClick?.());
    expect(screen.queryByRole("group", { name: "Location actions" })).toBeNull();

    act(() =>
      mapHandlers.onContextMenu?.({
        lngLat: { lat: 1, lng: 2 },
        originalEvent: { preventDefault: jest.fn() },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close popup" }));
    expect(screen.queryByRole("group", { name: "Location actions" })).toBeNull();

    act(() => mapHandlers.onMoveStart?.());
    expect(screen.queryByTestId("journey-line-overlay")).toBeNull();
    act(() => mapHandlers.onDragStart?.());
    act(() => mapHandlers.onWheel?.());
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
    const markers = screen.getAllByTestId("marker");
    fireEvent.click(markers[0]!);
    expect(screen.getByRole("link", { name: /kansai/i })).toHaveAttribute("href", stackOne.href);
    fireEvent.click(markers[0]!);
    expect(screen.getByRole("link", { name: /kansai/i })).toHaveAttribute("href", stackTwo.href);
    fireEvent.click(markers[2]!);
    expect(screen.getByRole("link", { name: /kansai/i })).toHaveAttribute(
      "href",
      elsewhereOne.href,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close popup" }));
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
    fireEvent.click(screen.getAllByTestId("marker")[0]!);
    view.rerender(
      <MMap
        photos={[oldPhoto, recentPhoto]}
        className="map"
        timeRange={{ fromMs: new Date(2023, 0, 1).valueOf(), toMs: new Date(2025, 0, 1).valueOf() }}
      />,
    );
    expect(screen.queryByRole("link", { name: /kansai/i })).toBeNull();

    fireEvent.mouseOver(screen.getByLabelText(/Photo from kansai/));
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
    const source = JSON.parse(screen.getByTestId("journey-line-source").dataset.source!);
    expect(source.features).toHaveLength(2);
    expect(
      source.features.map((feature: { properties: { album: string } }) => feature.properties.album),
    ).toEqual(["a", "b"]);
    expect(layerProps.get("journey-line-layer")?.paint).toEqual(
      expect.objectContaining({ "line-opacity": 1 }),
    );
    expect(layerProps.get("journey-line-glow-layer")?.paint?.["line-color"]).toEqual(
      expect.arrayContaining(["coalesce"]),
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
    expect(screen.getByTestId("journey-line-source")).toBeInTheDocument();
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
    expect(screen.queryByTestId("journey-line-source")).toBeNull();

    view.rerender(
      <MMap
        photos={[photo, { ...photo, href: "/album/kansai#two.jpg", decLat: 36, decLng: 140 }]}
        className="map"
        showRoute
        routeDisplayMode="always"
        routeMode="simplified"
      />,
    );
    expect(screen.getByTestId("journey-line-source")).toBeInTheDocument();
    expect(layerProps.get("journey-line-layer")?.paint).toEqual(
      expect.objectContaining({ "line-opacity": 0.55, "line-width": 4 }),
    );
  });
});
