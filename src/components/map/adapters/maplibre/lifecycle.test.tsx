/**
 * @jest-environment jsdom
 */

import { act, render } from "@testing-library/react";
import React from "react";
import { MapContext } from "./context";
import type { FilterSpecification } from "./engine";
import { gl } from "./engine";
import { Layer } from "./Layer";
import { Marker, type MarkerProps } from "./Marker";
import { MapView } from "./MapView";
import { Popup } from "./Popup";
import { Source } from "./Source";
import type { MapRef } from "./types";

/** The marker options MapLibre can change without rebuilding the marker. */
type SettableMarkerProps = Partial<
  Pick<
    MarkerProps,
    | "offset"
    | "draggable"
    | "rotation"
    | "rotationAlignment"
    | "pitchAlignment"
    | "subpixelPositioning"
    | "opacity"
    | "className"
  >
>;

/*
 * jsdom has no WebGL, so the engine seam is replaced wholesale. The fakes are
 * deliberately strict where MapLibre is strict — `addLayer` refuses a layer
 * whose source is missing, `removeSource` refuses while a layer still uses it —
 * because those refusals are the failure modes these cases exist to catch.
 */
jest.mock("./engine", () => {
  type Listener = (event: unknown) => void;
  type Spec = Record<string, unknown>;

  class GeoJSONSource {
    data: unknown;

    constructor(spec: Spec) {
      this.data = spec.data;
    }

    setData(data: unknown): Promise<void> {
      this.data = data;

      return Promise.resolve();
    }
  }

  class MapMock {
    /** Set to make the next construction throw, as a missing GL context does. */
    static failConstruction: Error | null = null;
    static instances: MapMock[] = [];
    _removed = false;
    style: { _loaded: boolean } = { _loaded: true };
    /** An ordered trace of every style mutation, for ordering assertions. */
    operations: string[] = [];
    sources = new Map<string, { spec: Spec; instance: unknown }>();
    layers = new Map<string, Spec>();
    layerOrder: string[] = [];
    listeners = new Map<string, Set<Listener>>();
    paintCalls: [string, string, unknown][] = [];
    layoutCalls: [string, string, unknown][] = [];
    filterCalls: [string, unknown][] = [];
    zoomRangeCalls: [string, number, number][] = [];
    moveCalls: [string, string | undefined][] = [];
    projection: { type: string } | undefined;
    /** How deep a `setProjection` → `styledata` → `setProjection` chain is. */
    projectionDepth = 0;
    canvas = document.createElement("canvas");

    constructor() {
      if (MapMock.failConstruction) {
        throw MapMock.failConstruction;
      }
      MapMock.instances.push(this);
    }

    on(type: string, listener: Listener): this {
      const registered = this.listeners.get(type) ?? new Set<Listener>();
      registered.add(listener);
      this.listeners.set(type, registered);

      return this;
    }

    off(type: string, listener: Listener): this {
      this.listeners.get(type)?.delete(listener);

      return this;
    }

    fire(type: string, event?: unknown): void {
      for (const listener of new Set(this.listeners.get(type) ?? [])) {
        listener(event ?? { type });
      }
    }

    /** What a style swap or a WebGL context restore does: everything goes. */
    reloadStyle(): void {
      this.sources.clear();
      this.layers.clear();
      this.layerOrder = [];
      this.operations.push("reloadStyle");
      this.fire("styledata");
    }

    getSource(id: string): unknown {
      return this.sources.get(id)?.instance;
    }

    addSource(id: string, spec: Spec): void {
      this.operations.push(`addSource:${id}`);
      this.sources.set(id, {
        spec,
        instance: spec.type === "geojson" ? new GeoJSONSource(spec) : { type: spec.type },
      });
    }

    removeSource(id: string): void {
      for (const [layerId, layer] of this.layers) {
        if (layer.source === id) {
          // MapLibre fires an error event and keeps the source.
          this.operations.push(`refusedRemoveSource:${id}:${layerId}`);

          return;
        }
      }
      this.operations.push(`removeSource:${id}`);
      this.sources.delete(id);
    }

    getLayer(id: string): Spec | undefined {
      return this.layers.get(id);
    }

    getLayersOrder(): string[] {
      return [...this.layerOrder];
    }

    addLayer(spec: Spec, beforeId?: string): void {
      const source = spec.source;
      if (typeof source === "string" && !this.sources.has(source)) {
        // MapLibre validates and drops it, with no retry of its own.
        this.operations.push(`refusedLayer:${String(spec.id)}`);

        return;
      }
      const id = String(spec.id);
      this.operations.push(`addLayer:${id}`);
      this.layers.set(id, spec);
      const at = beforeId ? this.layerOrder.indexOf(beforeId) : -1;
      if (at === -1) {
        this.layerOrder.push(id);
      } else {
        this.layerOrder.splice(at, 0, id);
      }
    }

    removeLayer(id: string): void {
      this.operations.push(`removeLayer:${id}`);
      this.layers.delete(id);
      this.layerOrder = this.layerOrder.filter((layerId) => layerId !== id);
    }

    moveLayer(id: string, beforeId?: string): void {
      this.moveCalls.push([id, beforeId]);
    }
    setPaintProperty(layerId: string, name: string, value: unknown): void {
      this.paintCalls.push([layerId, name, value]);
    }
    setLayoutProperty(layerId: string, name: string, value: unknown): void {
      this.layoutCalls.push([layerId, name, value]);
    }
    setFilter(layerId: string, filter: unknown): void {
      this.filterCalls.push([layerId, filter]);
    }
    setLayerZoomRange(layerId: string, minzoom: number, maxzoom: number): void {
      this.zoomRangeCalls.push([layerId, minzoom, maxzoom]);
    }
    getProjection(): { type: string } | undefined {
      return this.projection;
    }
    /**
     * Setting the projection mutates the style, so MapLibre fires `styledata`
     * again — which is what the adapter's re-entry guard exists for. The depth
     * cap keeps an unguarded loop from recursing without bound, so the case
     * reports how many times the projection was set rather than a stack trace.
     */
    setProjection(projection: { type: string }): void {
      this.operations.push(`setProjection:${projection.type}`);
      this.projection = projection;
      if (this.projectionDepth >= 3) {
        return;
      }
      this.projectionDepth += 1;
      try {
        this.fire("styledata");
      } finally {
        this.projectionDepth -= 1;
      }
    }
    setStyle(): void {}
    getCanvas(): HTMLCanvasElement {
      return this.canvas;
    }
    remove(): void {
      this._removed = true;
    }
  }

  class MarkerMock {
    static instances: MarkerMock[] = [];
    options: Spec;
    element: HTMLElement;
    lngLat: [number, number] = [0, 0];
    attachedTo: unknown = null;
    removed = false;
    calls: string[] = [];

    constructor(options: Spec = {}) {
      this.options = options;
      this.element =
        options.element instanceof HTMLElement ? options.element : document.createElement("div");
      MarkerMock.instances.push(this);
    }

    getElement(): HTMLElement {
      return this.element;
    }
    setLngLat(lngLat: [number, number]): this {
      this.lngLat = lngLat;

      return this;
    }
    getLngLat(): { lng: number; lat: number } {
      return { lng: this.lngLat[0], lat: this.lngLat[1] };
    }
    addTo(map: unknown): this {
      this.attachedTo = map;
      this.removed = false;

      return this;
    }
    remove(): this {
      this.removed = true;
      this.attachedTo = null;

      return this;
    }
    setOffset(offset: unknown): this {
      this.calls.push(`setOffset:${JSON.stringify(offset)}`);

      return this;
    }
    setDraggable(draggable: unknown): this {
      this.calls.push(`setDraggable:${JSON.stringify(draggable)}`);

      return this;
    }
    setRotation(rotation: unknown): this {
      this.calls.push(`setRotation:${JSON.stringify(rotation)}`);

      return this;
    }
    setRotationAlignment(alignment: unknown): this {
      this.calls.push(`setRotationAlignment:${JSON.stringify(alignment)}`);

      return this;
    }
    setPitchAlignment(alignment: unknown): this {
      this.calls.push(`setPitchAlignment:${JSON.stringify(alignment)}`);

      return this;
    }
    setSubpixelPositioning(positioning: unknown): this {
      this.calls.push(`setSubpixelPositioning:${JSON.stringify(positioning)}`);

      return this;
    }
    setOpacity(opacity: unknown, opacityWhenCovered: unknown): this {
      this.calls.push(
        `setOpacity:${JSON.stringify([opacity ?? null, opacityWhenCovered ?? null])}`,
      );

      return this;
    }
    addClassName(name: string): void {
      this.calls.push(`addClassName:${name}`);
    }
    removeClassName(name: string): void {
      this.calls.push(`removeClassName:${name}`);
    }
  }

  /**
   * What MapLibre focuses when a popup opens, verbatim from
   * `maplibre-gl-dev.mjs` (`focusQuerySelector`, beside `_focusFirstElement`).
   */
  const FOCUS_QUERY = [
    "a[href]",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable]:not([contenteditable='false'])",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
  ].join(", ");

  class PopupMock {
    static instances: PopupMock[] = [];
    options: Spec;
    lngLat: [number, number] = [0, 0];
    open = false;
    addToCount = 0;
    content: HTMLElement | null = null;
    listeners = new Map<string, Set<Listener>>();
    calls: string[] = [];

    constructor(options: Spec = {}) {
      this.options = options;
      PopupMock.instances.push(this);
    }

    on(type: string, listener: Listener): this {
      const registered = this.listeners.get(type) ?? new Set<Listener>();
      registered.add(listener);
      this.listeners.set(type, registered);

      return this;
    }
    off(type: string, listener: Listener): this {
      this.listeners.get(type)?.delete(listener);

      return this;
    }
    fire(type: string): void {
      for (const listener of new Set(this.listeners.get(type) ?? [])) {
        listener({ type });
      }
    }
    setDOMContent(content: HTMLElement): this {
      this.content = content;

      return this;
    }
    /**
     * A real popup puts its content in the document and then — unless
     * `focusAfterOpen` says otherwise, and it defaults to true — moves focus to
     * the first focusable thing inside it (`Popup._focusFirstElement`). Both
     * halves are modelled, because the focus grab is only observable once the
     * content is actually attached.
     */
    addTo(): this {
      this.addToCount += 1;
      this.open = true;
      if (this.content) {
        document.body.append(this.content);
      }
      this.fire("open");
      if (this.options.focusAfterOpen !== false) {
        this.content?.querySelector<HTMLElement>(FOCUS_QUERY)?.focus();
      }

      return this;
    }
    remove(): this {
      this.open = false;
      this.content?.remove();
      this.fire("close");

      return this;
    }
    isOpen(): boolean {
      return this.open;
    }
    setLngLat(lngLat: [number, number]): this {
      this.lngLat = lngLat;

      return this;
    }
    getLngLat(): { lng: number; lat: number } {
      return { lng: this.lngLat[0], lat: this.lngLat[1] };
    }
    setOffset(offset: unknown): this {
      this.calls.push(`setOffset:${JSON.stringify(offset)}`);

      return this;
    }
    setMaxWidth(): this {
      this.calls.push("setMaxWidth");

      return this;
    }
    addClassName(name: string): void {
      this.calls.push(`addClassName:${name}`);
    }
    removeClassName(name: string): void {
      this.calls.push(`removeClassName:${name}`);
    }
  }

  const setWorkerUrl = jest.fn();

  return {
    gl: {
      Map: MapMock,
      Marker: MarkerMock,
      Popup: PopupMock,
      GeoJSONSource,
      setWorkerUrl,
    },
  };
});

/* -------------------------------------------------------------------------- */
/* Reaching into the fakes                                                     */
/* -------------------------------------------------------------------------- */

type MockMapApi = MapRef & {
  operations: string[];
  paintCalls: [string, string, unknown][];
  layoutCalls: [string, string, unknown][];
  filterCalls: [string, unknown][];
  zoomRangeCalls: [string, number, number][];
  moveCalls: [string, string | undefined][];
  fire: (type: string, event?: unknown) => void;
  reloadStyle: () => void;
  sources: Map<string, { spec: Record<string, unknown>; instance: unknown }>;
  layers: Map<string, Record<string, unknown>>;
  layerOrder: string[];
  style: { _loaded: boolean };
};

type MockMarkerApi = {
  options: Record<string, unknown>;
  element: HTMLElement;
  lngLat: [number, number];
  attachedTo: unknown;
  removed: boolean;
  calls: string[];
};

type MockPopupApi = {
  options: Record<string, unknown>;
  lngLat: [number, number];
  addToCount: number;
  open: boolean;
  calls: string[];
  remove: () => void;
};

const mapClass = gl.Map as unknown as {
  failConstruction: Error | null;
  instances: MockMapApi[];
  new (): MockMapApi;
};
const markerInstances = () => (gl.Marker as unknown as { instances: MockMarkerApi[] }).instances;
const popupInstances = () => (gl.Popup as unknown as { instances: MockPopupApi[] }).instances;
const workerUrlMock = gl.setWorkerUrl as unknown as jest.Mock;

const createMap = (): MockMapApi => new mapClass();

/** The map the component under test just built. */
const lastMap = (): MockMapApi => {
  const last = mapClass.instances.at(-1);
  if (!last) {
    throw new Error("No map was constructed.");
  }

  return last;
};

const renderInMap = (map: MockMapApi, ui: React.ReactNode) => {
  const wrap = (children: React.ReactNode) => (
    <MapContext.Provider value={{ map }}>{children}</MapContext.Provider>
  );
  const result = render(wrap(ui));

  return {
    ...result,
    update: (next: React.ReactNode) => {
      result.rerender(wrap(next));
    },
  };
};

const EMPTY_GEOJSON = { type: "FeatureCollection" as const, features: [] };

beforeEach(() => {
  mapClass.failConstruction = null;
  mapClass.instances.length = 0;
  markerInstances().length = 0;
  popupInstances().length = 0;
  workerUrlMock.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* MapView — failure is visible, and never blanks the whole map UI             */
/* -------------------------------------------------------------------------- */

describe("MapView failure handling", () => {
  // `worker.ts` keeps a module-level "already installed" flag that is only set
  // after a successful call, so this case has to come before any map is built.
  // The flag itself is covered independently in `worker.test.ts`.
  it("reports a worker installation failure as its own kind, and still builds the map", () => {
    workerUrlMock.mockImplementationOnce(() => {
      throw new TypeError("gl.setWorkerUrl is not a function");
    });
    const onError = jest.fn();

    const { container } = render(
      <MapView onError={onError}>
        <div data-testid="child" />
      </MapView>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ type: "worker" });
    // A broken build is not a missing GPU: the map is still there.
    expect(container.querySelector("[data-map-status]")).toHaveAttribute(
      "data-map-status",
      "ready",
    );
  });

  it("mounts children as soon as the map exists, without waiting for load", () => {
    const onLoad = jest.fn();

    const { container, getByTestId } = render(
      <MapView onLoad={onLoad}>
        <div data-testid="child" />
      </MapView>,
    );

    // The whole point: a style that never loads must not take the markers,
    // popups, controls and overlays down with the basemap.
    expect(getByTestId("child")).toBeInTheDocument();
    expect(onLoad).not.toHaveBeenCalled();
    expect(container.querySelector("[data-map-status]")).toHaveAttribute(
      "data-map-status",
      "ready",
    );
  });

  it("still distinguishes a loaded basemap from a merely constructed one", () => {
    const onLoad = jest.fn();
    const { container } = render(<MapView onLoad={onLoad} />);
    const map = lastMap();

    act(() => {
      map.fire("load", { type: "load" });
    });

    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-map-status]")).toHaveAttribute(
      "data-map-status",
      "loaded",
    );
  });

  it("reports a construction failure as terminal and mounts no children", () => {
    mapClass.failConstruction = new Error("Failed to initialize WebGL");
    const onError = jest.fn();

    const { container, queryByTestId } = render(
      <MapView onError={onError}>
        <div data-testid="child" />
      </MapView>,
    );

    expect(onError).toHaveBeenCalledWith({
      type: "construct",
      error: expect.objectContaining({ message: "Failed to initialize WebGL" }) as Error,
    });
    expect(queryByTestId("child")).not.toBeInTheDocument();
    // Terminal, and said so — a caller showing a spinner can stop.
    expect(container.querySelector("[data-map-status]")).toHaveAttribute(
      "data-map-status",
      "unavailable",
    );
  });

  it("surfaces errors the live map reports", () => {
    const onError = jest.fn();
    render(<MapView onError={onError} />);
    const map = lastMap();

    act(() => {
      map.fire("error", { error: new Error("style 404") });
    });

    expect(onError).toHaveBeenCalledWith({
      type: "runtime",
      error: expect.objectContaining({ message: "style 404" }) as Error,
    });
  });

  it("does not touch the projection until the style can take it, and sets it once", () => {
    render(<MapView projection="globe" />);
    const map = lastMap();
    map.style._loaded = false;

    act(() => {
      map.fire("styledata");
    });
    expect(map.operations).not.toContain("setProjection:globe");

    map.style._loaded = true;
    act(() => {
      map.fire("styledata");
    });
    // Setting it mutates the style, so MapLibre fires `styledata` again — the
    // very event this is applied from. Without the compare-first guard that is
    // an unbounded loop; the fake stops recursing after a few rounds so the
    // count reports it rather than a stack overflow.
    expect(map.operations.filter((operation) => operation === "setProjection:globe")).toHaveLength(
      1,
    );
  });

  it("gives its WebGL context back when the map unmounts", () => {
    // Route-level, and behind a deferred component: every navigation away
    // unmounts it, and a context that is never released is one fewer the
    // browser will hand out (they are capped, and the cap is low).
    const { unmount } = render(<MapView />);
    const map = lastMap();

    expect(map._removed).toBe(false);

    unmount();

    expect(map._removed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Source and Layer                                                            */
/* -------------------------------------------------------------------------- */

describe("Source and Layer lifecycle", () => {
  it("adds the source before the layer that depends on it", () => {
    const map = createMap();

    renderInMap(
      map,
      <Source id="s" type="geojson" data={EMPTY_GEOJSON}>
        <Layer id="l" type="circle" />
      </Source>,
    );

    expect(map.operations).toEqual(["addSource:s", "addLayer:l"]);
  });

  it("re-adds source before layer after a style rebuild", () => {
    const map = createMap();
    renderInMap(
      map,
      <Source id="s" type="geojson" data={EMPTY_GEOJSON}>
        <Layer id="l" type="circle" />
      </Source>,
    );

    // A style swap or a WebGL context restore wipes both, and React flushes the
    // resulting effects child-first. The layer used to be re-added against a
    // style whose sources were gone, get rejected, and stay missing.
    act(() => {
      map.reloadStyle();
    });

    expect(map.operations).toEqual([
      "addSource:s",
      "addLayer:l",
      "reloadStyle",
      "addSource:s",
      "addLayer:l",
    ]);
    expect(map.getLayer("l")).toBeDefined();
  });

  it("rebuilds the source when an option MapLibre only reads at construction changes", () => {
    const map = createMap();
    const tree = (lineMetrics: boolean) => (
      <Source
        id="s"
        type="geojson"
        data={EMPTY_GEOJSON}
        {...(lineMetrics ? { lineMetrics: true } : {})}
      >
        <Layer id="l" type="line" />
      </Source>
    );
    const { update } = renderInMap(map, tree(false));

    expect(map.sources.get("s")?.spec.lineMetrics).toBeUndefined();

    // `MapWorld` does exactly this when the time filter flips between one album
    // and many: a `line-progress` taper appears on a source built without it.
    update(tree(true));

    expect(map.sources.get("s")?.spec.lineMetrics).toBe(true);
    expect(map.getLayer("l")).toBeDefined();
    expect(map.operations).toEqual([
      "addSource:s",
      "addLayer:l",
      "removeLayer:l",
      "removeSource:s",
      "addSource:s",
      "addLayer:l",
    ]);
  });

  it("sends new data through the live source instead of rebuilding it", () => {
    const map = createMap();
    const tree = (data: GeoJSON.FeatureCollection) => (
      <Source id="s" type="geojson" data={data}>
        <Layer id="l" type="line" />
      </Source>
    );
    const { update } = renderInMap(map, tree(EMPTY_GEOJSON));
    // Every update the map makes — a time-range filter, a search narrowing the
    // results, a journey rebuilt around the selected pin — arrives this way.
    const next: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [1, 2] } },
      ],
    };

    update(tree(next));

    expect((map.getSource("s") as unknown as { data: unknown }).data).toBe(next);
    // In place: rebuilding would drop and re-add the layers drawn on it.
    expect(map.operations).toEqual(["addSource:s", "addLayer:l"]);
  });

  it("sweeps only the layers React added when the source goes", () => {
    const map = createMap();
    const { unmount } = renderInMap(
      map,
      <Source id="s" type="geojson" data={EMPTY_GEOJSON}>
        <Layer id="l" type="circle" />
      </Source>,
    );
    // A layer the style document declared on the same source. Serialising the
    // whole style and removing everything pointing at the id used to take it.
    map.addLayer({ id: "style-owned", type: "circle", source: "s" });

    unmount();

    expect(map.getLayer("style-owned")).toBeDefined();
    expect(map.operations).toContain("removeLayer:l");
    expect(map.operations).not.toContain("removeLayer:style-owned");
  });

  it("leaves a source the style document declared where it found it", () => {
    const map = createMap();
    // Already in the style, as a source the style document declares would be.
    map.addSource("s", { type: "geojson", data: EMPTY_GEOJSON });

    const { unmount } = renderInMap(
      map,
      <Source id="s" type="geojson" data={EMPTY_GEOJSON}>
        <Layer id="l" type="circle" />
      </Source>,
    );
    // Adopted rather than rebuilt, so the layers can still mount on it.
    expect(map.getLayer("l")).toBeDefined();
    expect(map.operations).toEqual(["addSource:s", "addLayer:l"]);

    unmount();

    // The layer sweep is careful to leave style-declared layers alone; taking
    // the source they hang off would undo that care one level up.
    expect(map.operations).toContain("removeLayer:l");
    expect(map.operations).not.toContain("removeSource:s");
    expect(map.getSource("s")).toBeDefined();
  });

  it("waits rather than adding a layer whose source is not in the style", () => {
    const map = createMap();

    renderInMap(map, <Layer id="orphan" type="circle" source="missing" />);

    // Not even attempted: MapLibre would reject it and never retry.
    expect(map.operations).toEqual([]);
    expect(map.getLayer("orphan")).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Layer reconciliation — the steady state, not the mount                      */
/* -------------------------------------------------------------------------- */

describe("Layer reconciliation", () => {
  type CirclePaint = {
    "circle-color"?: string;
    "circle-opacity"?: number;
  };

  const circleLayer = (paint: CirclePaint) => (
    <Source id="s" type="geojson" data={EMPTY_GEOJSON}>
      <Layer id="l" type="circle" paint={paint} />
    </Source>
  );

  it("sends the paint a change touched, and clears what the new style stopped setting", () => {
    const map = createMap();
    const { update } = renderInMap(
      map,
      circleLayer({ "circle-color": "#12bcd4", "circle-opacity": 0.24 }),
    );

    // The layer was added with its paint, so nothing has been set on it yet.
    expect(map.paintCalls).toEqual([]);

    // Selecting a pin brightens that pin's own journey back up. Miss this and
    // a route de-emphasised once stays dimmed for the rest of the session.
    update(circleLayer({ "circle-color": "#12bcd4", "circle-opacity": 1 }));

    // Only the property that moved: re-sending the colour would repaint the
    // whole layer on every hover.
    expect(map.paintCalls).toEqual([["l", "circle-opacity", 1]]);

    // Dropped from the style altogether, which means "back to the default".
    update(circleLayer({ "circle-color": "#12bcd4" }));

    expect(map.paintCalls).toEqual([
      ["l", "circle-opacity", 1],
      ["l", "circle-opacity", undefined],
    ]);
  });

  it("sends the layout a change touched, and clears what the new style stopped setting", () => {
    const map = createMap();
    const tree = (layout: { visibility?: "visible" | "none" }) => (
      <Source id="s" type="geojson" data={EMPTY_GEOJSON}>
        <Layer id="l" type="circle" layout={layout} />
      </Source>
    );
    const { update } = renderInMap(map, tree({ visibility: "none" }));

    update(tree({ visibility: "visible" }));
    expect(map.layoutCalls).toEqual([["l", "visibility", "visible"]]);

    update(tree({}));
    expect(map.layoutCalls).toEqual([
      ["l", "visibility", "visible"],
      ["l", "visibility", undefined],
    ]);
  });

  it("applies a filter when it changes, and not when it is only a new array", () => {
    const map = createMap();
    const tree = (dash: string) => (
      <Source id="s" type="geojson" data={EMPTY_GEOJSON}>
        <Layer id="l" type="line" filter={["==", ["get", "dash"], dash] as FilterSpecification} />
      </Source>
    );
    const { update } = renderInMap(map, tree("2-2"));

    // `MapWorld` splits its journey lines into one layer per dash pattern, and
    // the filter is what decides which features each of them draws.
    update(tree("solid"));
    expect(map.filterCalls).toEqual([["l", ["==", ["get", "dash"], "solid"]]]);

    // Rebuilt every render, so identity says nothing — an equal filter must not
    // reach the map, or every render would re-run the layer's feature pass.
    update(tree("solid"));
    expect(map.filterCalls).toHaveLength(1);
  });

  it("moves the layer's zoom bounds, and falls back to the spec defaults when they go", () => {
    const map = createMap();
    const tree = (zoom: { minzoom?: number; maxzoom?: number }) => (
      <Source id="s" type="geojson" data={EMPTY_GEOJSON}>
        <Layer id="l" type="circle" {...zoom} />
      </Source>
    );
    const { update } = renderInMap(map, tree({ minzoom: 4 }));

    update(tree({ minzoom: 6, maxzoom: 12 }));
    expect(map.zoomRangeCalls).toEqual([["l", 6, 12]]);

    // MapLibre has no "unset" for either bound, so the style-spec defaults are
    // named explicitly; leaving them would pin the layer to the old window.
    update(tree({}));
    expect(map.zoomRangeCalls).toEqual([
      ["l", 6, 12],
      ["l", 0, 24],
    ]);
  });

  it("restacks the layer when the layer it draws beneath changes", () => {
    const map = createMap();
    const tree = (beforeId?: string) => (
      <Source id="s" type="geojson" data={EMPTY_GEOJSON}>
        <Layer id="pins" type="circle" />
        <Layer id="l" type="line" {...(beforeId ? { beforeId } : {})} />
      </Source>
    );
    const { update } = renderInMap(map, tree());

    // Selecting a pin remounts the journey lines, which arrive on top of
    // everything already drawn — including the pins being aimed at.
    update(tree("pins"));

    expect(map.moveCalls).toEqual([["l", "pins"]]);
  });
});

/* -------------------------------------------------------------------------- */
/* Marker                                                                      */
/* -------------------------------------------------------------------------- */

describe("Marker reconciliation", () => {
  it("rebuilds the marker when children appear, so they are not portaled into the default pin", () => {
    const map = createMap();
    const { update } = renderInMap(map, <Marker longitude={1} latitude={2} />);

    expect(markerInstances()).toHaveLength(1);
    expect(markerInstances()[0]?.options.element).toBeUndefined();

    update(
      <Marker longitude={1} latitude={2}>
        <span data-testid="pin">pin</span>
      </Marker>,
    );

    expect(markerInstances()).toHaveLength(2);
    expect(markerInstances()[1]?.options.element).toBeInstanceOf(HTMLElement);
    expect(markerInstances()[0]?.removed).toBe(true);
    expect(markerInstances()[1]?.attachedTo).toBe(map);
  });

  it("rebuilds on an anchor change and reuses the marker for a settable one", () => {
    const map = createMap();
    const { update } = renderInMap(
      map,
      <Marker longitude={1} latitude={2} anchor="center">
        <span>pin</span>
      </Marker>,
    );

    update(
      <Marker longitude={1} latitude={2} anchor="center" offset={[0, 5]}>
        <span>pin</span>
      </Marker>,
    );
    expect(markerInstances()).toHaveLength(1);
    expect(markerInstances()[0]?.calls).toContain("setOffset:[0,5]");

    update(
      <Marker longitude={1} latitude={2} anchor="bottom" offset={[0, 5]}>
        <span>pin</span>
      </Marker>,
    );
    expect(markerInstances()).toHaveLength(2);
    expect(markerInstances()[1]?.options.anchor).toBe("bottom");
  });

  it("puts an offset back to the default when the caller stops setting one", () => {
    const map = createMap();
    const { update } = renderInMap(
      map,
      <Marker longitude={1} latitude={2} offset={[0, 5]}>
        <span>pin</span>
      </Marker>,
    );

    update(
      <Marker longitude={1} latitude={2}>
        <span>pin</span>
      </Marker>,
    );

    // Named rather than passed through: MapLibre has no "unset", and its
    // `setOffset` hands the argument straight to `Point.convert`, which throws
    // on `undefined`.
    expect(markerInstances()[0]?.calls).toContain("setOffset:[0,0]");
  });

  /**
   * Every option MapLibre can change on a live marker. Each of them is a
   * separate branch that only runs when that one prop moves, so a table is the
   * only shape that keeps them all honest.
   */
  const settableOptions: [
    name: string,
    from: SettableMarkerProps,
    to: SettableMarkerProps,
    expected: string[],
  ][] = [
    ["offset", {}, { offset: [0, 5] }, ["setOffset:[0,5]"]],
    ["draggable", {}, { draggable: true }, ["setDraggable:true"]],
    ["rotation", {}, { rotation: 45 }, ["setRotation:45"]],
    ["rotationAlignment", {}, { rotationAlignment: "map" }, ['setRotationAlignment:"map"']],
    ["pitchAlignment", {}, { pitchAlignment: "map" }, ['setPitchAlignment:"map"']],
    ["subpixelPositioning", {}, { subpixelPositioning: true }, ["setSubpixelPositioning:true"]],
    ["opacity", {}, { opacity: "0.4" }, ['setOpacity:["0.4",null]']],
    [
      "className",
      { className: "hover" },
      { className: "click" },
      ["removeClassName:hover", "addClassName:click"],
    ],
  ];

  it.each(settableOptions)("reconciles %s on the live marker", (_name, from, to, expected) => {
    const map = createMap();
    const { update } = renderInMap(
      map,
      <Marker longitude={1} latitude={2} {...from}>
        <span>pin</span>
      </Marker>,
    );

    update(
      <Marker longitude={1} latitude={2} {...to}>
        <span>pin</span>
      </Marker>,
    );

    // None of these is a construction option, so the marker — and the portal
    // rendering into it — has to survive the change.
    expect(markerInstances()).toHaveLength(1);
    expect(markerInstances()[0]?.calls).toEqual(expected);
  });

  it("clears style properties that the new style no longer sets", () => {
    const map = createMap();
    const { update } = renderInMap(
      map,
      <Marker longitude={1} latitude={2} style={{ opacity: "0.3", color: "red" }}>
        <span>pin</span>
      </Marker>,
    );
    const element = markerInstances()[0]?.element;

    expect(element?.style.color).toBe("red");

    // A muted pin becoming the active one used to stay muted for ever.
    update(
      <Marker longitude={1} latitude={2} style={{ opacity: "1" }}>
        <span>pin</span>
      </Marker>,
    );

    expect(element?.style.opacity).toBe("1");
    expect(element?.style.color).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* Popup                                                                       */
/* -------------------------------------------------------------------------- */

describe("Popup focus", () => {
  /** Something outside the popup for focus to be taken away from. */
  const renderOpener = (): HTMLElement => {
    const opener = document.createElement("button");
    opener.type = "button";
    document.body.append(opener);
    opener.focus();

    return opener;
  };

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("leaves focus where it was when a popup opens", () => {
    const map = createMap();
    const opener = renderOpener();

    renderInMap(
      map,
      <Popup longitude={1} latitude={2}>
        <a href="#kansai">kansai</a>
      </Popup>,
    );

    // MapLibre would have pulled focus onto the link. Popups here open because
    // something else was hovered or focused, so that both robs the reader of
    // their place and unmounts the popup: the opener blurs, whatever state was
    // holding the popup open is dropped, and focus falls through to <body>.
    expect(document.activeElement).toBe(opener);
  });

  it("still lets a caller ask for the provider's own focus behaviour", () => {
    const map = createMap();
    renderOpener();

    renderInMap(
      map,
      <Popup longitude={1} latitude={2} focusAfterOpen>
        <a href="#kansai">kansai</a>
      </Popup>,
    );

    expect(popupInstances()[0]?.options.focusAfterOpen).toBe(true);
    expect((document.activeElement as HTMLAnchorElement | null)?.textContent).toBe("kansai");
  });
});

describe("Popup re-attachment", () => {
  it("comes back when the anchor moves after MapLibre closed it", () => {
    const map = createMap();
    const { update } = renderInMap(
      map,
      <Popup longitude={1} latitude={2}>
        <span>one</span>
      </Popup>,
    );
    const popup = popupInstances()[0];

    expect(popup?.addToCount).toBe(1);

    // `closeOnClick` is on by default, and MapLibre closes the popup itself.
    act(() => {
      popup?.remove();
    });
    expect(popup?.open).toBe(false);

    // Dismissed where it stands, it stays dismissed.
    update(
      <Popup longitude={1} latitude={2}>
        <span>two</span>
      </Popup>,
    );
    expect(popup?.addToCount).toBe(1);

    // Pointing it at a new place is a fresh request for a popup there.
    update(
      <Popup longitude={3} latitude={4}>
        <span>two</span>
      </Popup>,
    );
    expect(popup?.addToCount).toBe(2);
    expect(popup?.lngLat).toEqual([3, 4]);
  });

  it("applies the differences that accumulated while it was closed", () => {
    const map = createMap();
    const { update } = renderInMap(
      map,
      <Popup longitude={1} latitude={2} className="hover">
        <span>one</span>
      </Popup>,
    );
    const popup = popupInstances()[0];

    act(() => {
      popup?.remove();
    });
    update(
      <Popup longitude={3} latitude={4} className="click">
        <span>one</span>
      </Popup>,
    );

    expect(popup?.calls).toContain("removeClassName:hover");
    expect(popup?.calls).toContain("addClassName:click");
  });
});
