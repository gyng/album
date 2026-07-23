/**
 * @jest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { DataLayer, MapView, useMap } from "./index";
import type { MapInstance } from "./port";

const mapProps = jest.fn();
const sourceProps = jest.fn();
const layerProps = jest.fn();
const markerProps = jest.fn();
const popupProps = jest.fn();

// jsdom has no WebGL, so the adapter is replaced wholesale — the same pattern
// the existing map component tests use. What is under test here is the
// translation between the neutral port and the adapter's surface.
let currentEngineMap: unknown = null;
jest.mock("./adapters/maplibre", () => ({
  __esModule: true,
  default: ({ children, ...props }: { children?: ReactNode }) => {
    mapProps(props);
    return <div data-testid="map">{children}</div>;
  },
  Source: ({ children, ...props }: { children?: ReactNode }) => {
    sourceProps(props);
    return <div data-testid="source">{children}</div>;
  },
  Layer: (props: { id: string }) => {
    layerProps(props);
    return <div data-testid="layer">{props.id}</div>;
  },
  Marker: ({ children, ...props }: { children?: ReactNode }) => {
    markerProps(props);
    return <div data-testid="marker">{children}</div>;
  },
  Popup: ({ children, ...props }: { children?: ReactNode }) => {
    popupProps(props);
    return <div data-testid="popup">{children}</div>;
  },
  useMap: () => ({ current: currentEngineMap }),
}));

type EngineListener = (event: unknown) => void;

const engineListeners = new Map<string, Set<EngineListener>>();
const container = document.createElement("div");

const engine = {
  getCenter: jest.fn(() => ({ lng: 10, lat: 20 })),
  getZoom: jest.fn(() => 4),
  getBounds: jest.fn(() => ({
    getWest: () => -1,
    getSouth: () => -2,
    getEast: () => 3,
    getNorth: () => 4,
  })),
  flyTo: jest.fn(),
  fitBounds: jest.fn(),
  project: jest.fn(() => ({ x: 12, y: 34 })),
  unproject: jest.fn(() => ({ lng: 5, lat: 6 })),
  getContainer: jest.fn(() => container),
  on: jest.fn((type: string, listener: EngineListener) => {
    const registered = engineListeners.get(type) ?? new Set<EngineListener>();
    registered.add(listener);
    engineListeners.set(type, registered);
  }),
  off: jest.fn((type: string, listener: EngineListener) => {
    engineListeners.get(type)?.delete(listener);
  }),
};

const fireEngineEvent = (type: string, event?: unknown) => {
  // Copied first, so a listener that unsubscribes itself cannot disturb the walk.
  for (const listener of new Set(engineListeners.get(type) ?? [])) {
    listener(event);
  }
};

/** The props the mocked adapter map was last rendered with. */
const lastMapProps = () => mapProps.mock.calls.at(-1)?.[0];

/** Renders a map and hands back the neutral instance its `onLoad` published. */
const renderLoadedMap = (children?: ReactNode): MapInstance => {
  let instance: MapInstance | undefined;
  render(
    <MapView
      styleUrl="https://tiles.example/style.json"
      initialView={{ center: { lng: 103, lat: 1.25 }, zoom: 6 }}
      onLoad={(map) => {
        instance = map;
      }}
    >
      {children}
    </MapView>,
  );
  act(() => {
    lastMapProps().onLoad({ type: "load", target: engine });
  });
  if (!instance) {
    throw new Error("the map never published an instance");
  }

  return instance;
};

beforeEach(() => {
  mapProps.mockClear();
  sourceProps.mockClear();
  layerProps.mockClear();
  markerProps.mockClear();
  popupProps.mockClear();
  engine.flyTo.mockClear();
  engine.fitBounds.mockClear();
  engine.project.mockClear();
  engine.unproject.mockClear();
  engine.on.mockClear();
  engine.off.mockClear();
  engineListeners.clear();
  currentEngineMap = null;
});

// The contract every adapter has to satisfy, exercised only through the port.
describe("MapInstance contract", () => {
  it("reads the camera in neutral shapes", () => {
    const map = renderLoadedMap();

    expect(map.getCenter()).toEqual({ lng: 10, lat: 20 });
    expect(map.getZoom()).toBe(4);
    expect(map.getBounds()).toEqual([
      { lng: -1, lat: -2 },
      { lng: 3, lat: 4 },
    ]);
    expect(map.getContainer()).toBe(container);
  });

  it("moves the camera, omitting options the caller left out", () => {
    const map = renderLoadedMap();

    map.flyTo({ center: { lng: 50, lat: 5 }, zoom: 10.5, speed: 2.2 });
    expect(engine.flyTo).toHaveBeenCalledWith({ center: [50, 5], zoom: 10.5, speed: 2.2 });

    map.flyTo({ center: { lng: 1, lat: 2 } });
    expect(engine.flyTo).toHaveBeenLastCalledWith({ center: [1, 2] });

    map.fitBounds(
      [
        { lng: 179, lat: 1 },
        { lng: -179, lat: 2 },
      ],
      { padding: 36, maxZoom: 11, animate: false },
    );
    expect(engine.fitBounds).toHaveBeenCalledWith(
      [
        [179, 1],
        [-179, 2],
      ],
      { padding: 36, maxZoom: 11, animate: false },
    );

    map.fitBounds([
      { lng: 0, lat: 0 },
      { lng: 1, lat: 1 },
    ]);
    expect(engine.fitBounds).toHaveBeenLastCalledWith(
      [
        [0, 0],
        [1, 1],
      ],
      {},
    );
  });

  it("round-trips projection between geography and screen pixels", () => {
    const map = renderLoadedMap();

    expect(map.project({ lng: 103, lat: 1.25 })).toEqual({ x: 12, y: 34 });
    expect(engine.project).toHaveBeenCalledWith([103, 1.25]);
    expect(map.unproject({ x: 12, y: 34 })).toEqual({ lng: 5, lat: 6 });
    expect(engine.unproject).toHaveBeenCalledWith([12, 34]);
  });

  it("subscribes to camera events and detaches through the returned disposer", () => {
    const map = renderLoadedMap();
    const onMoveEnd = jest.fn();

    const unsubscribe = map.on("moveend", onMoveEnd);
    fireEngineEvent("moveend");
    expect(onMoveEnd).toHaveBeenCalledWith({
      type: "moveend",
      view: { center: { lng: 10, lat: 20 }, zoom: 4 },
    });

    unsubscribe();
    fireEngineEvent("moveend");
    expect(onMoveEnd).toHaveBeenCalledTimes(1);
    expect(engine.off).toHaveBeenCalledWith("moveend", expect.any(Function));
  });

  it("translates pointer and wheel events into neutral payloads", () => {
    const map = renderLoadedMap();
    const onClick = jest.fn();
    const onWheel = jest.fn();
    const click = new MouseEvent("click");
    const wheel = new WheelEvent("wheel");

    map.on("click", onClick);
    map.on("wheel", onWheel);
    fireEngineEvent("click", {
      lngLat: { lng: 103, lat: 1.25 },
      point: { x: 7, y: 8 },
      originalEvent: click,
    });
    fireEngineEvent("wheel", { originalEvent: wheel });

    expect(onClick).toHaveBeenCalledWith({
      type: "click",
      at: { lng: 103, lat: 1.25 },
      point: { x: 7, y: 8 },
      originalEvent: click,
    });
    expect(onWheel).toHaveBeenCalledWith({ type: "wheel", originalEvent: wheel });
  });
});

describe("MapView", () => {
  it("passes the style and initial camera to the adapter", () => {
    renderLoadedMap();

    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({
        mapStyle: "https://tiles.example/style.json",
        initialViewState: { longitude: 103, latitude: 1.25, zoom: 6 },
      }),
    );
  });

  it("reports movement and clicks in neutral shapes", () => {
    const onMoveEnd = jest.fn();
    const onClick = jest.fn();
    const click = new MouseEvent("click");
    render(
      <MapView styleUrl="style.json" onMoveEnd={onMoveEnd} onClick={onClick}>
        {null}
      </MapView>,
    );

    act(() => {
      lastMapProps().onMoveEnd({ viewState: { longitude: 30, latitude: 40, zoom: 8 } });
      lastMapProps().onClick({
        lngLat: { lng: 1, lat: 2 },
        point: { x: 3, y: 4 },
        originalEvent: click,
      });
    });

    expect(onMoveEnd).toHaveBeenCalledWith({ center: { lng: 30, lat: 40 }, zoom: 8 });
    expect(onClick).toHaveBeenCalledWith({
      type: "click",
      at: { lng: 1, lat: 2 },
      point: { x: 3, y: 4 },
      originalEvent: click,
    });
  });
});

describe("useMap", () => {
  const Probe = ({ report }: { report: (map: MapInstance | undefined) => void }) => {
    report(useMap());
    return null;
  };

  it("hands back the instance itself, stable across renders", () => {
    currentEngineMap = engine;
    const seen: Array<MapInstance | undefined> = [];
    const view = render(<Probe report={(map) => seen.push(map)} />);
    view.rerender(<Probe report={(map) => seen.push(map)} />);

    expect(seen[0]).toBeDefined();
    expect(seen[0]?.getZoom()).toBe(4);
    expect(seen[1]).toBe(seen[0]);
  });

  it("is undefined until there is a map", () => {
    const seen: Array<MapInstance | undefined> = [];
    render(<Probe report={(map) => seen.push(map)} />);

    expect(seen[0]).toBeUndefined();
  });
});

describe("DataLayer", () => {
  const points = [
    { id: "a", at: { lng: 103.75, lat: 1.25 }, color: "rgb(1, 2, 3)", radius: 9 },
    { id: "b", at: { lng: 151.21, lat: -33.86 } },
  ];

  it("draws points as a GeoJSON source and one data-driven circle layer", () => {
    render(<MapView styleUrl="style.json">{<DataLayer id="photos" points={points} />}</MapView>);

    expect(sourceProps).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "photos-points",
        type: "geojson",
        cluster: false,
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "a",
              properties: { id: "a", color: "rgb(1, 2, 3)", radius: 9 },
              geometry: { type: "Point", coordinates: [103.75, 1.25] },
            },
            {
              type: "Feature",
              id: "b",
              properties: { id: "b" },
              geometry: { type: "Point", coordinates: [151.21, -33.86] },
            },
          ],
        },
      }),
    );
    expect(layerProps).toHaveBeenCalledTimes(1);
    expect(layerProps).toHaveBeenCalledWith({
      id: "photos-point-circles",
      type: "circle",
      paint: {
        "circle-color": ["coalesce", ["get", "color"], "rgb(230, 32, 101)"],
        "circle-radius": ["coalesce", ["get", "radius"], 5],
      },
    });
  });

  it("adds cluster and cluster-count layers when clustering is asked for", () => {
    render(
      <MapView styleUrl="style.json">{<DataLayer id="photos" points={points} cluster />}</MapView>,
    );

    expect(sourceProps).toHaveBeenCalledWith(
      expect.objectContaining({ cluster: true, clusterMaxZoom: 12, clusterRadius: 42 }),
    );
    expect(screen.getAllByTestId("layer").map((node) => node.textContent)).toEqual([
      "photos-clusters",
      "photos-cluster-labels",
      "photos-point-circles",
    ]);
    const [clusters, labels, circles] = layerProps.mock.calls.map(([props]) => props);
    expect(clusters).toEqual(
      expect.objectContaining({ type: "circle", filter: ["has", "point_count"] }),
    );
    expect(clusters.paint["circle-radius"][0]).toBe("step");
    expect(labels).toEqual(
      expect.objectContaining({
        type: "symbol",
        layout: expect.objectContaining({ "text-field": ["get", "point_count"] }),
      }),
    );
    // Individual points must not be drawn twice: clustered ones belong to the
    // cluster layer, so the circle layer only takes what is left.
    expect(circles.filter).toEqual(["!", ["has", "point_count"]]);
  });

  it("draws lines as their own source and line layer", () => {
    const lines = [
      {
        id: "guess",
        path: [
          { lng: 0, lat: 0 },
          { lng: 10, lat: 20 },
        ],
        color: "rgb(9, 9, 9)",
        width: 2,
      },
    ];
    render(<MapView styleUrl="style.json">{<DataLayer id="round" lines={lines} />}</MapView>);

    expect(sourceProps).toHaveBeenCalledTimes(1);
    expect(sourceProps).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "round-lines",
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "guess",
              properties: { id: "guess", color: "rgb(9, 9, 9)", width: 2 },
              geometry: {
                type: "LineString",
                coordinates: [
                  [0, 0],
                  [10, 20],
                ],
              },
            },
          ],
        },
      }),
    );
    expect(layerProps).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "round-line-strokes",
        type: "line",
        paint: { "line-color": ["get", "color"], "line-width": ["get", "width"] },
      }),
    );
  });

  it("updates the source data in place when the points change", () => {
    const view = render(
      <MapView styleUrl="style.json">{<DataLayer id="photos" points={points} />}</MapView>,
    );
    const source = screen.getByTestId("source");

    view.rerender(
      <MapView styleUrl="style.json">
        {<DataLayer id="photos" points={[{ id: "c", at: { lng: 5, lat: 6 } }]} />}
      </MapView>,
    );

    // Same mounted source, same id: the adapter sees new data rather than a
    // removed and re-added source.
    expect(screen.getByTestId("source")).toBe(source);
    const [previous, next] = sourceProps.mock.calls.map(([props]) => props);
    expect(next.id).toBe(previous.id);
    expect(next.data.features).toHaveLength(1);
    expect(next.data.features[0].geometry.coordinates).toEqual([5, 6]);
  });
});
