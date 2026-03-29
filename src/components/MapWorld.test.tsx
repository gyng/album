/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { MapWorldEntry } from "./MapWorld";

const mapHandlers: {
  onMoveStart?: () => void;
  onMoveEnd?: (event: {
    viewState: { latitude: number; longitude: number; zoom: number };
  }) => void;
  onZoomStart?: () => void;
  onZoom?: (event: { viewState: { zoom: number } }) => void;
} = {};

const mapInstance = {
  flyTo: jest.fn(),
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
  const React = require("react");

  return {
    __esModule: true,
    default: ({
      children,
      onMoveStart,
      onMoveEnd,
      onZoomStart,
      onZoom,
    }: {
      children?: React.ReactNode;
      onMoveStart?: () => void;
      onMoveEnd?: (event: {
        viewState: { latitude: number; longitude: number; zoom: number };
      }) => void;
      onZoomStart?: () => void;
      onZoom?: (event: { viewState: { zoom: number } }) => void;
    }) => {
      mapHandlers.onMoveStart = onMoveStart;
      mapHandlers.onMoveEnd = onMoveEnd;
      mapHandlers.onZoomStart = onZoomStart;
      mapHandlers.onZoom = onZoom;
      return <div data-testid="map">{children}</div>;
    },
    Marker: ({
      children,
      onClick,
    }: {
      children?: React.ReactNode;
      onClick?: (event: {
        originalEvent: { stopPropagation: () => void };
      }) => void;
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
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => (
      <div data-testid="popup" className={className}>
        {children}
      </div>
    ),
    ScaleControl: () => null,
    NavigationControl: () => null,
    GeolocateControl: () => null,
    FullscreenControl: () => null,
    Source: ({
      children,
      id,
      data,
    }: {
      children?: React.ReactNode;
      id?: string;
      data?: unknown;
    }) => (
      <div data-testid={id ?? "source"} data-source={JSON.stringify(data)}>
        {children}
      </div>
    ),
    Layer: ({ id }: { id?: string }) => <div data-testid={id ?? "layer"} />,
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
    children: React.ReactNode;
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
  ThemeToggle: () => null,
}));

jest.mock("../util/time", () => ({
  getRelativeTimeString: () => "just now",
}));

const { MMap } = require("./MapWorld");

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
    jest.useFakeTimers();
    mapHandlers.onMoveStart = undefined;
    mapHandlers.onMoveEnd = undefined;
    mapHandlers.onZoomStart = undefined;
    mapHandlers.onZoom = undefined;
    mapInstance.flyTo.mockClear();
    mapInstance.on.mockClear();
    mapInstance.off.mockClear();
    mapInstance.project.mockClear();
    mapInstance.getBounds.mockClear();
    replaceStateSpy = jest
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => {});
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

    expect(
      screen.getByRole("link", { name: /kansai/i }).getAttribute("href"),
    ).toBe("/album/kansai#photo.jpg");
    expect(screen.getByTestId("popup").className).toContain("click");
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
});
