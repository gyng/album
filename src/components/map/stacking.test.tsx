/**
 * @jest-environment jsdom
 */

/*
 * Layer stacking, exercised through the real port over the real adapter.
 *
 * `react.test.tsx` mocks the adapter, so it can only see which moves the port
 * asks for — not what the style ends up looking like. The defects this file
 * covers live in the join between the two: the port applies its stack once, and
 * the adapter re-adds layers underneath it afterwards. So only the engine is
 * doubled here, and every assertion is about the drawn order the engine is left
 * holding.
 */

import { act, render } from "@testing-library/react";
import { DataLayer, MapView } from "./index";
import { gl } from "./adapters/maplibre/engine";

/*
 * jsdom has no WebGL, so the engine seam is replaced wholesale. The double is
 * strict where MapLibre is strict — a layer is appended as it is added, a
 * source cannot go while a layer still uses it — because appending is exactly
 * the behaviour the stacking exists to correct for.
 */
jest.mock("./adapters/maplibre/engine", () => {
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
    static instances: MapMock[] = [];
    _removed = false;
    style: { _loaded: boolean } = { _loaded: true };
    /** An ordered trace of every style mutation, for churn assertions. */
    operations: string[] = [];
    sources = new Map<string, unknown>();
    layers = new Map<string, Spec>();
    /** Bottom first, the way a style document lists them. */
    layerOrder: string[] = [];
    listeners = new Map<string, Set<Listener>>();
    canvas = document.createElement("canvas");

    constructor() {
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
      return this.sources.get(id);
    }

    addSource(id: string, spec: Spec): void {
      this.operations.push(`addSource:${id}`);
      this.sources.set(id, spec.type === "geojson" ? new GeoJSONSource(spec) : { type: spec.type });
    }

    removeSource(id: string): void {
      for (const layer of this.layers.values()) {
        if (layer.source === id) {
          // MapLibre fires an error event and keeps the source.
          this.operations.push(`refusedRemoveSource:${id}`);

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
        // Appended on top, which is the whole reason stacking has to be re-applied.
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
      if (!this.layers.has(id)) {
        throw new Error(`moveLayer: no layer "${id}"`);
      }
      this.operations.push(`moveLayer:${id}`);
      const remaining = this.layerOrder.filter((layerId) => layerId !== id);
      const at = beforeId ? remaining.indexOf(beforeId) : -1;
      if (at === -1) {
        remaining.push(id);
      } else {
        remaining.splice(at, 0, id);
      }
      this.layerOrder = remaining;
      // Every style mutation is heard by the sources and layers on the map.
      this.fire("styledata");
    }

    setPaintProperty(): void {}
    setLayoutProperty(): void {}
    setFilter(): void {}
    setLayerZoomRange(): void {}
    getProjection(): { type: string } | undefined {
      return undefined;
    }
    setProjection(): void {}
    setStyle(): void {}
    getCanvas(): HTMLCanvasElement {
      return this.canvas;
    }
    remove(): void {
      this._removed = true;
    }
  }

  return {
    gl: {
      Map: MapMock,
      Marker: class {},
      Popup: class {},
      GeoJSONSource,
      setWorkerUrl: jest.fn(),
    },
  };
});

type MockMapApi = {
  operations: string[];
  layerOrder: string[];
  reloadStyle: () => void;
};

const mapClass = gl.Map as unknown as { instances: MockMapApi[] };

/** The map the component under test just built. */
const lastMap = (): MockMapApi => {
  const last = mapClass.instances.at(-1);
  if (!last) {
    throw new Error("No map was constructed.");
  }

  return last;
};

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
const TAPER = [
  { at: 0, width: 1 },
  { at: 1, width: 6 },
];

/**
 * The pins are declared first but drawn last, so mount order and declared order
 * disagree from the outset — `MapWorld` draws its journey beneath its photo
 * pins the same way round.
 */
const scene = (taper: boolean) => (
  <MapView styleUrl="style.json">
    <DataLayer id="pins" points={points} order={40} />
    <DataLayer
      id="journey"
      lines={lines}
      order={20}
      {...(taper ? { lineWidthAlong: TAPER } : {})}
    />
  </MapView>
);

/** The same two layers, with the journey declared to draw above the pins. */
const journeyOnTop = (taper: boolean) => (
  <MapView styleUrl="style.json">
    <DataLayer id="pins" points={points} order={20} />
    <DataLayer
      id="journey"
      lines={lines}
      order={40}
      {...(taper ? { lineWidthAlong: TAPER } : {})}
    />
  </MapView>
);

beforeEach(() => {
  mapClass.instances.length = 0;
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DataLayer stacking against a live style", () => {
  it("applies the declared order over the order the layers happened to mount in", () => {
    render(scene(false));

    expect(lastMap().layerOrder).toEqual(["journey-line-strokes", "pins-point-circles"]);
  });

  it("re-applies the stack when a source rebuild re-adds its layers", () => {
    const view = render(scene(false));
    const map = lastMap();

    // A taper needs `lineMetrics`, which MapLibre only reads when it builds the
    // source — so the source is rebuilt and its layers are re-added on top of
    // the pins that never moved. `MapWorld` does exactly this when the time
    // filter crosses an album boundary and the journey starts tapering.
    view.rerender(scene(true));

    expect(map.operations).toContain("removeSource:journey-lines");
    expect(map.operations).toContain("addLayer:journey-line-strokes");
    expect(map.layerOrder).toEqual(["journey-line-strokes", "pins-point-circles"]);
  });

  it("re-applies the stack after the whole style reloads", () => {
    render(scene(false));
    const map = lastMap();

    // A style swap or a WebGL context restore drops every source and layer, and
    // they are all re-added in mount order — declared order and all.
    act(() => {
      map.reloadStyle();
    });

    expect(map.layerOrder).toEqual(["journey-line-strokes", "pins-point-circles"]);
  });

  it("moves nothing when a rebuild happens to leave the stack as declared", () => {
    const view = render(journeyOnTop(false));
    const map = lastMap();

    expect(map.layerOrder).toEqual(["pins-point-circles", "journey-line-strokes"]);
    const settled = map.operations.length;

    view.rerender(journeyOnTop(true));

    // The rebuild re-appends the journey on top, which is where it belongs, so
    // the stack is already the declared one. Every move marks the style changed
    // and re-renders every source and layer on the map, so a pass that would
    // move nothing must not make one — which is also what keeps a restack
    // provoked by a style change from provoking another one.
    expect(map.operations.slice(settled)).toEqual([
      "removeLayer:journey-line-strokes",
      "removeSource:journey-lines",
      "addSource:journey-lines",
      "addLayer:journey-line-strokes",
    ]);
    expect(map.layerOrder).toEqual(["pins-point-circles", "journey-line-strokes"]);
  });
});
