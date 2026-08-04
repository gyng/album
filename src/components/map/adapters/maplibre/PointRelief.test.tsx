/**
 * @jest-environment jsdom
 */

import { act, render } from "@testing-library/react";
import React from "react";
import { MapContext } from "./context";
import { PointRelief, reliefTileResponse } from "./PointRelief";
import type { MapRef } from "./types";

jest.mock("./engine", () => ({
  gl: { addProtocol: jest.fn(), removeProtocol: jest.fn() },
}));

type Listener = () => void;

/**
 * The parts of MapLibre this component touches — including the part that made
 * the first version unusable: `setTerrain` is itself a style mutation, so it
 * fires `styledata`, and anything that re-attaches on `styledata` re-enters.
 */
class MapMock {
  _removed = false;
  style = { _loaded: true };
  operations: string[] = [];
  sources = new Map<string, Record<string, unknown>>();
  layers = new Map<string, Record<string, unknown>>();
  terrain: { source: string; exaggeration: number } | null = null;
  listeners = new Map<string, Set<Listener>>();

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
      listener();
    }
  }

  getStyle(): { layers: { id: string; type: string }[] } {
    return { layers: [{ id: "place-labels", type: "symbol" }] };
  }

  getSource(id: string): unknown {
    return this.sources.get(id);
  }

  addSource(id: string, spec: Record<string, unknown>): void {
    this.operations.push(`addSource:${id}`);
    this.sources.set(id, spec);
    this.fire("styledata");
  }

  removeSource(id: string): void {
    this.operations.push(`removeSource:${id}`);
    this.sources.delete(id);
  }

  getLayer(id: string): unknown {
    return this.layers.get(id);
  }

  addLayer(spec: Record<string, unknown>, beforeId?: string): void {
    this.operations.push(`addLayer:${String(spec.id)}:${beforeId ?? "top"}`);
    this.layers.set(String(spec.id), spec);
    this.fire("styledata");
  }

  removeLayer(id: string): void {
    this.operations.push(`removeLayer:${id}`);
    this.layers.delete(id);
  }

  setTerrain(terrain: { source: string; exaggeration: number } | null): void {
    this.operations.push(terrain ? `setTerrain:${terrain.source}` : "setTerrain:null");
    this.terrain = terrain;
    this.fire("styledata");
  }

  /** What a style swap does: sources and terrain go together. */
  reloadStyle(): void {
    this.sources.clear();
    this.layers.clear();
    this.terrain = null;
    this.operations.push("reloadStyle");
    this.fire("styledata");
  }
}

const points = [
  { lng: 139.767, lat: 35.681 },
  { lng: 139.7, lat: 35.7 },
];

const renderRelief = (
  map: MapMock,
  props: Partial<React.ComponentProps<typeof PointRelief>> = {},
) =>
  render(
    <MapContext.Provider value={{ map: map as unknown as MapRef }}>
      <PointRelief id="relief" points={points} {...props} />
    </MapContext.Provider>,
  );

describe("PointRelief", () => {
  it("gives the map an elevation source of its own and stands the terrain on it", () => {
    const map = new MapMock();
    renderRelief(map);

    expect(map.sources.get("relief")).toMatchObject({
      type: "raster-dem",
      encoding: "terrarium",
    });
    expect(map.terrain).toEqual({ source: "relief", exaggeration: 1.4 });
  });

  // Terrain draped in a flat basemap is invisible; the shading is what makes it
  // a landscape, and it belongs under the labels.
  it("shades the relief, beneath the writing", () => {
    const map = new MapMock();
    renderRelief(map);

    expect(map.layers.get("relief-shade")).toMatchObject({ type: "hillshade", source: "relief" });
    expect(map.operations).toContain("addLayer:relief-shade:place-labels");
  });

  // `setTerrain` fires `styledata`, so re-attaching on `styledata` without a
  // guard rebuilt the terrain forever: tiles never stopped arriving and the map
  // never finished loading.
  it("does not re-enter when its own attachment fires a style event", () => {
    const map = new MapMock();
    renderRelief(map);

    expect(map.operations.filter((operation) => operation === "addSource:relief")).toHaveLength(1);
    expect(
      map.operations.filter((operation) => operation.startsWith("setTerrain:relief")),
    ).toHaveLength(1);
  });

  it("puts itself back after a style reload takes it away", () => {
    const map = new MapMock();
    renderRelief(map);

    act(() => {
      map.reloadStyle();
    });

    expect(map.sources.has("relief")).toBe(true);
    expect(map.terrain).toEqual({ source: "relief", exaggeration: 1.4 });
  });

  // MapLibre refuses to remove a source that the terrain still stands on.
  it("takes the terrain down before the source it stood on", () => {
    const map = new MapMock();
    const { unmount } = renderRelief(map);

    unmount();

    const removal = map.operations.slice(map.operations.lastIndexOf("setTerrain:null"));
    expect(removal).toContain("removeSource:relief");
    expect(map.terrain).toBeNull();
    expect(map.sources.has("relief")).toBe(false);
    expect(map.layers.has("relief-shade")).toBe(false);
  });

  it("takes the exaggeration and zoom limit it is given", () => {
    const map = new MapMock();
    renderRelief(map, { exaggeration: 3, maxzoom: 11 });

    expect(map.terrain).toEqual({ source: "relief", exaggeration: 3 });
    expect(map.sources.get("relief")).toMatchObject({ maxzoom: 11 });
  });

  // The tiles are cached by URL, so a different landscape has to be a different
  // URL or the map keeps drawing the old one.
  it("names the tiles after the data they were made from", () => {
    const map = new MapMock();
    renderRelief(map);

    expect(map.sources.get("relief")?.tiles).toEqual(["point-relief://relief/{z}/{x}/{y}?v=2"]);
  });

  it("does nothing at all without a map", () => {
    expect(() =>
      render(
        <MapContext.Provider value={null}>
          <PointRelief points={points} />
        </MapContext.Provider>,
      ),
    ).not.toThrow();
  });
});

describe("reliefTileResponse", () => {
  it("refuses a URL that is not a relief tile", async () => {
    await expect(reliefTileResponse("https://example.test/12/1/2.png")).rejects.toThrow(
      /Not a relief tile/,
    );
  });
});
