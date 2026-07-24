/**
 * @jest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import {
  DataLayer,
  DEFAULT_CLUSTER_LABEL_FONT,
  FullscreenControl,
  GeolocateControl,
  type MapControlProps,
  MapView,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  useMap,
} from "./index";
import type { MapInstance } from "./port";

const mapProps = jest.fn();
const sourceProps = jest.fn();
const layerProps = jest.fn();
const markerProps = jest.fn();
const popupProps = jest.fn();
/** Records which adapter control was rendered, and with what. */
const controlProps = jest.fn();

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
  // The real controls render nothing of their own — they hand an object to the
  // engine — so the mocks record the call and render nothing either.
  NavigationControl: (props: { position?: string }) => {
    controlProps("NavigationControl", props);
    return null;
  },
  GeolocateControl: (props: { position?: string }) => {
    controlProps("GeolocateControl", props);
    return null;
  },
  ScaleControl: (props: { position?: string }) => {
    controlProps("ScaleControl", props);
    return null;
  },
  FullscreenControl: (props: { position?: string }) => {
    controlProps("FullscreenControl", props);
    return null;
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
  // Stacking reads and reorders the layers the adapter added; the double
  // reports every layer as present so the port's ordering decisions show up in
  // the moves it asks for.
  getLayer: jest.fn((id: string) => ({ id })),
  moveLayer: jest.fn(),
  // Layer-scoped subscriptions take an extra layer id between the event name
  // and the listener, so both arities are accepted here.
  on: jest.fn((type: string, second: string | EngineListener, third?: EngineListener) => {
    const listener = typeof second === "function" ? second : third;
    if (!listener) {
      return;
    }

    const registered = engineListeners.get(type) ?? new Set<EngineListener>();
    registered.add(listener);
    engineListeners.set(type, registered);
  }),
  off: jest.fn((type: string, second: string | EngineListener, third?: EngineListener) => {
    const listener = typeof second === "function" ? second : third;
    if (listener) {
      engineListeners.get(type)?.delete(listener);
    }
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
  controlProps.mockClear();
  engine.flyTo.mockClear();
  engine.fitBounds.mockClear();
  engine.project.mockClear();
  engine.unproject.mockClear();
  engine.on.mockClear();
  engine.off.mockClear();
  engine.getLayer.mockClear();
  engine.moveLayer.mockClear();
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

  it("reports every camera event a gesture-driven consumer listens for", () => {
    const onMoveStart = jest.fn();
    const onZoomStart = jest.fn();
    const onZoom = jest.fn();
    const onZoomEnd = jest.fn();
    const onDragStart = jest.fn();
    const onWheel = jest.fn();
    const wheel = new WheelEvent("wheel");
    render(
      <MapView
        styleUrl="style.json"
        onMoveStart={onMoveStart}
        onZoomStart={onZoomStart}
        onZoom={onZoom}
        onZoomEnd={onZoomEnd}
        onDragStart={onDragStart}
        onWheel={onWheel}
      >
        {null}
      </MapView>,
    );

    // A different camera per event, so a handler wired to the wrong engine
    // event would show up as the wrong view rather than passing by luck.
    act(() => {
      lastMapProps().onMoveStart({ viewState: { longitude: 1, latitude: 2, zoom: 3 } });
      lastMapProps().onZoomStart({ viewState: { longitude: 4, latitude: 5, zoom: 6 } });
      lastMapProps().onZoom({ viewState: { longitude: 7, latitude: 8, zoom: 9 } });
      lastMapProps().onZoomEnd({ viewState: { longitude: 10, latitude: 11, zoom: 12 } });
      lastMapProps().onDragStart({ viewState: { longitude: 13, latitude: 14, zoom: 15 } });
      lastMapProps().onWheel({ originalEvent: wheel });
    });

    expect(onMoveStart).toHaveBeenCalledWith({ center: { lng: 1, lat: 2 }, zoom: 3 });
    expect(onZoomStart).toHaveBeenCalledWith({ center: { lng: 4, lat: 5 }, zoom: 6 });
    expect(onZoom).toHaveBeenCalledWith({ center: { lng: 7, lat: 8 }, zoom: 9 });
    expect(onZoomEnd).toHaveBeenCalledWith({ center: { lng: 10, lat: 11 }, zoom: 12 });
    expect(onDragStart).toHaveBeenCalledWith({ center: { lng: 13, lat: 14 }, zoom: 15 });
    expect(onWheel).toHaveBeenCalledWith({ type: "wheel", originalEvent: wheel });
  });

  it("collapses the attribution itself rather than asking the provider to", () => {
    // A compact notice as the provider first renders it: shown, and open.
    const notice = document.createElement("details");
    notice.className = "maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show";
    notice.setAttribute("open", "");
    container.append(notice);
    const onLoad = jest.fn();

    render(
      <MapView
        styleUrl="style.json"
        attribution={{ compact: true, collapsed: true }}
        onLoad={onLoad}
      >
        {null}
      </MapView>,
    );
    act(() => {
      lastMapProps().onLoad({ type: "load", target: engine });
    });

    // `collapsed` is the port's own idea, so the provider is only told to be
    // compact; starting shut is the binding's own work on load.
    expect(lastMapProps().attributionControl).toEqual({ compact: true });
    expect(notice.classList.contains("maplibregl-compact-show")).toBe(false);
    expect(notice.hasAttribute("open")).toBe(false);
    // …and that work does not stand in for the caller's own load handler.
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0]?.[0].getCenter()).toEqual({ lng: 10, lat: 20 });

    notice.remove();
  });

  it("leaves a compact notice open when it was not asked to start shut", () => {
    const notice = document.createElement("details");
    notice.className = "maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show";
    notice.setAttribute("open", "");
    container.append(notice);

    render(
      <MapView styleUrl="style.json" attribution={{ compact: true }}>
        {null}
      </MapView>,
    );
    act(() => {
      lastMapProps().onLoad({ type: "load", target: engine });
    });

    expect(lastMapProps().attributionControl).toEqual({ compact: true });
    expect(notice.classList.contains("maplibregl-compact-show")).toBe(true);
    expect(notice.hasAttribute("open")).toBe(true);

    notice.remove();
  });
});

describe("map controls", () => {
  const controls: ReadonlyArray<[string, ComponentType<MapControlProps>]> = [
    ["NavigationControl", NavigationControl],
    ["GeolocateControl", GeolocateControl],
    ["ScaleControl", ScaleControl],
    ["FullscreenControl", FullscreenControl],
  ];

  it.each(controls)("renders the adapter's %s, anchored where asked", (name, Control) => {
    render(<Control position="bottom-left" />);

    expect(controlProps).toHaveBeenCalledTimes(1);
    expect(controlProps).toHaveBeenCalledWith(name, { position: "bottom-left" });
  });

  it.each(controls)("leaves %s in the provider's own corner by default", (name, Control) => {
    render(<Control />);

    // Omitted rather than passed as undefined, so the provider's default stands.
    expect(controlProps).toHaveBeenCalledWith(name, {});
  });
});

describe("Marker", () => {
  it("places the marker, and sits its element where the caller asked", () => {
    render(
      <MapView styleUrl="style.json">
        <Marker at={{ lng: 103.75, lat: 1.25 }} anchor="bottom">
          pin
        </Marker>
      </MapView>,
    );

    expect(markerProps).toHaveBeenCalledWith(
      expect.objectContaining({ longitude: 103.75, latitude: 1.25, anchor: "bottom" }),
    );
    expect(screen.getByTestId("marker").textContent).toBe("pin");
  });

  it("leaves the anchor to the provider when the caller does not choose one", () => {
    render(
      <MapView styleUrl="style.json">
        <Marker at={{ lng: 1, lat: 2 }}>pin</Marker>
      </MapView>,
    );

    expect(markerProps.mock.calls.at(-1)?.[0]).not.toHaveProperty("anchor");
  });
});

describe("Popup", () => {
  it("anchors the popup at the position it was given", () => {
    render(
      <MapView styleUrl="style.json">
        <Popup at={{ lng: 103.75, lat: 1.25 }}>details</Popup>
      </MapView>,
    );

    expect(popupProps).toHaveBeenCalledWith(
      expect.objectContaining({ longitude: 103.75, latitude: 1.25 }),
    );
    expect(screen.getByTestId("popup").textContent).toBe("details");
  });

  it("stays open through a map click, and shows no dismiss button, unless asked", () => {
    render(
      <MapView styleUrl="style.json">
        <Popup at={{ lng: 1, lat: 2 }}>details</Popup>
      </MapView>,
    );

    // The port's defaults, not the provider's: a popup opened by the very click
    // the application is still handling must not close itself on that click.
    const props = popupProps.mock.calls.at(-1)?.[0];
    expect(props).toEqual(expect.objectContaining({ closeButton: false, closeOnClick: false }));
    expect(props).not.toHaveProperty("offset");
    expect(props).not.toHaveProperty("className");
    expect(props).not.toHaveProperty("onClose");
  });

  it("carries the popup options a caller sets, and reports a dismissal back", () => {
    const onDismiss = jest.fn();
    render(
      <MapView styleUrl="style.json">
        <Popup
          at={{ lng: 1, lat: 2 }}
          offset={15}
          className="photo"
          showCloseButton
          dismissOnMapClick
          onDismiss={onDismiss}
        >
          details
        </Popup>
      </MapView>,
    );

    const props = popupProps.mock.calls.at(-1)?.[0];
    expect(props).toEqual(
      expect.objectContaining({
        offset: 15,
        className: "photo",
        closeButton: true,
        closeOnClick: true,
      }),
    );

    act(() => {
      props.onClose({ type: "close" });
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
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
        "circle-opacity": ["coalesce", ["get", "opacity"], 1],
      },
    });
  });

  it("carries per-feature opacity and draws a halo when one is asked for", () => {
    render(
      <MapView styleUrl="style.json">
        {
          <DataLayer
            id="photos"
            points={[{ id: "a", at: { lng: 1, lat: 2 }, opacity: 0.28 }]}
            stroke={{ color: "rgba(255, 255, 255, 0.84)", width: 2 }}
          />
        }
      </MapView>,
    );

    expect(sourceProps.mock.calls.at(-1)?.[0].data.features[0].properties).toEqual({
      id: "a",
      opacity: 0.28,
    });
    // The halo fades with its point, so a de-emphasised point keeps no ring.
    expect(layerProps.mock.calls.at(-1)?.[0].paint).toEqual(
      expect.objectContaining({
        "circle-stroke-color": "rgba(255, 255, 255, 0.84)",
        "circle-stroke-width": 2,
        "circle-stroke-opacity": ["coalesce", ["get", "opacity"], 1],
      }),
    );
  });

  it("reports clicks and hovers on points, and detaches them on unmount", () => {
    currentEngineMap = engine;
    const onPointClick = jest.fn();
    const onPointHover = jest.fn();
    const view = render(
      <MapView styleUrl="style.json">
        {
          <DataLayer
            id="photos"
            points={points}
            onPointClick={onPointClick}
            onPointHover={onPointHover}
          />
        }
      </MapView>,
    );

    const hit = { lngLat: { lng: 103.75, lat: 1.25 }, features: [{ properties: { id: "a" } }] };
    act(() => {
      fireEngineEvent("click", hit);
      fireEngineEvent("mousemove", hit);
      // Staying on the same point is not a new hover.
      fireEngineEvent("mousemove", hit);
      fireEngineEvent("mouseleave", undefined);
    });

    expect(onPointClick).toHaveBeenCalledWith({ id: "a", at: { lng: 103.75, lat: 1.25 } });
    expect(onPointHover.mock.calls).toEqual([
      [{ id: "a", at: { lng: 103.75, lat: 1.25 } }],
      [null],
    ]);
    // Subscribed against the circle layer, so clusters and other layers are
    // not mistaken for points.
    expect(engine.on).toHaveBeenCalledWith("click", "photos-point-circles", expect.any(Function));

    view.unmount();
    expect(engine.off).toHaveBeenCalledWith("click", "photos-point-circles", expect.any(Function));
    expect(engine.off).toHaveBeenCalledWith(
      "mousemove",
      "photos-point-circles",
      expect.any(Function),
    );
    expect(engine.off).toHaveBeenCalledWith(
      "mouseleave",
      "photos-point-circles",
      expect.any(Function),
    );
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
    // A provider draws no label at all when asked for a face its style has no
    // glyphs for, so the default is part of the layer's contract.
    expect(labels.layout["text-font"]).toEqual(DEFAULT_CLUSTER_LABEL_FONT);
    // Individual points must not be drawn twice: clustered ones belong to the
    // cluster layer, so the circle layer only takes what is left.
    expect(circles.filter).toEqual(["!", ["has", "point_count"]]);
  });

  it("letters cluster counts with the face a caller's own style provides", () => {
    render(
      <MapView styleUrl="style.json">
        <DataLayer id="photos" points={points} cluster clusterLabelFont={["Open Sans Bold"]} />
      </MapView>,
    );

    const labels = layerProps.mock.calls.map(([props]) => props)[1];
    expect(labels.layout["text-font"]).toEqual(["Open Sans Bold"]);
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

  it("tapers lines along their own length, and only then measures them", () => {
    const path = [
      { lng: 0, lat: 0 },
      { lng: 10, lat: 20 },
    ];
    const lines = [{ id: "trip", path, color: "rgb(9, 9, 9)", width: 3 }];
    const view = render(
      <MapView styleUrl="style.json">
        <DataLayer id="route" lines={lines} />
      </MapView>,
    );

    // Untapered: the width is read off each feature, and the provider is not
    // asked for the line-progress it would otherwise have to compute.
    expect(layerProps.mock.calls.at(-1)?.[0].paint["line-width"]).toEqual(["get", "width"]);
    expect(sourceProps.mock.calls.at(-1)?.[0]).not.toHaveProperty("lineMetrics");

    view.rerender(
      <MapView styleUrl="style.json">
        <DataLayer
          id="route"
          lines={lines}
          lineWidthAlong={[
            { at: 0, width: 1 },
            { at: 0.55, width: 6 },
            { at: 1, width: 2 },
          ]}
        />
      </MapView>,
    );

    expect(layerProps.mock.calls.at(-1)?.[0].paint["line-width"]).toEqual([
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      1,
      0.55,
      6,
      1,
      2,
    ]);
    expect(sourceProps.mock.calls.at(-1)?.[0].lineMetrics).toBe(true);
  });

  it("puts taper stops in the order and range a provider will accept", () => {
    const path = [
      { lng: 0, lat: 0 },
      { lng: 10, lat: 20 },
    ];
    render(
      <MapView styleUrl="style.json">
        <DataLayer
          id="route"
          lines={[{ id: "trip", path, color: "rgb(9, 9, 9)", width: 3 }]}
          lineWidthAlong={[
            { at: 1.4, width: 2 },
            { at: 0.55, width: 6 },
            { at: -0.2, width: 1 },
            { at: 0.55, width: 99 },
          ]}
        />
      </MapView>,
    );

    // Ascending, inside the line, and one width per position: a provider
    // interpolates over strictly increasing inputs and otherwise refuses the
    // layer outright, so the line would simply never draw. Callers building
    // stops from data should not have to know that.
    expect(layerProps.mock.calls.at(-1)?.[0].paint["line-width"]).toEqual([
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      1,
      0.55,
      6,
      1,
      2,
    ]);
  });

  it("falls back to each line's own width when the stops describe no taper", () => {
    const path = [
      { lng: 0, lat: 0 },
      { lng: 10, lat: 20 },
    ];
    render(
      <MapView styleUrl="style.json">
        <DataLayer
          id="route"
          lines={[{ id: "trip", path, color: "rgb(9, 9, 9)", width: 3 }]}
          lineWidthAlong={[]}
        />
      </MapView>,
    );

    expect(layerProps.mock.calls.at(-1)?.[0].paint["line-width"]).toEqual(["get", "width"]);
    expect(sourceProps.mock.calls.at(-1)?.[0]).not.toHaveProperty("lineMetrics");
  });

  it("splits lines into one layer per dash pattern, sharing a source", () => {
    const path = [
      { lng: 0, lat: 0 },
      { lng: 10, lat: 20 },
    ];
    render(
      <MapView styleUrl="style.json">
        {
          <DataLayer
            id="round"
            lines={[
              { id: "glow", path, color: "rgb(9, 9, 9)", width: 6, opacity: 0.2, blur: 4 },
              { id: "guess", path, color: "rgb(9, 9, 9)", width: 2, dash: [4, 3] },
            ]}
          />
        }
      </MapView>,
    );

    // A dash pattern cannot vary within one drawn layer, so the solid line and
    // the dashed one are drawn separately — in the order they were given.
    expect(sourceProps).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("layer").map((node) => node.textContent)).toEqual([
      "round-line-strokes",
      "round-line-strokes-4-3",
    ]);
    const [solid, dashed] = layerProps.mock.calls.map(([props]) => props);
    expect(solid.filter).toEqual(["!", ["has", "dashKey"]]);
    expect(solid.paint).toEqual(
      expect.objectContaining({
        "line-opacity": ["coalesce", ["get", "opacity"], 1],
        "line-blur": ["coalesce", ["get", "blur"], 0],
      }),
    );
    expect(solid.paint["line-dasharray"]).toBeUndefined();
    expect(dashed.filter).toEqual(["==", ["get", "dashKey"], "4-3"]);
    expect(dashed.paint["line-dasharray"]).toEqual([4, 3]);

    const [features] = sourceProps.mock.calls.map(([props]) => props.data.features);
    expect(features[0].properties).toEqual({
      id: "glow",
      color: "rgb(9, 9, 9)",
      width: 6,
      opacity: 0.2,
      blur: 4,
    });
    expect(features[1].properties.dashKey).toBe("4-3");
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

describe("DataLayer stacking", () => {
  const points = [{ id: "a", at: { lng: 103.75, lat: 1.25 } }];
  const lines = [
    {
      id: "trip",
      path: [
        { lng: 0, lat: 0 },
        { lng: 10, lat: 20 },
      ],
      color: "rgb(9, 9, 9)",
      width: 2,
    },
  ];

  const ordered = (route: boolean) => (
    <MapView styleUrl="style.json">
      <DataLayer id="pins" points={points} order={20} />
      {route ? <DataLayer id="route" lines={lines} order={10} /> : null}
    </MapView>
  );

  it("keeps the declared order when a layer remounts beside a settled one", () => {
    currentEngineMap = engine;
    const view = render(ordered(true));

    engine.moveLayer.mockClear();
    // The route goes away and comes back — the case a provider quietly resolves
    // by re-appending its layers on top of the pins that never moved.
    view.rerender(ordered(false));
    view.rerender(ordered(true));

    // Raised bottom-first, so the pins are back on top however the mounting went.
    expect(engine.moveLayer.mock.calls.map(([id]: [string]) => id).slice(-2)).toEqual([
      "route-line-strokes",
      "pins-point-circles",
    ]);
  });

  it("leaves the provider's own stacking alone when no layer declares an order", () => {
    currentEngineMap = engine;
    render(
      <MapView styleUrl="style.json">
        <DataLayer id="pins" points={points} />
        <DataLayer id="route" lines={lines} />
      </MapView>,
    );

    expect(engine.moveLayer).not.toHaveBeenCalled();
  });
});
