import React from "react";
import { gl } from "./engine";
import type { SourceSpecification } from "./engine";
import { type SourceAttachment, SourceContext, useAttachedMap } from "./context";
import {
  deepEqual,
  isStyleUsable,
  useGeneratedId,
  useLatestRef,
  useStyleVersion,
} from "./internal";
import type { MapRef } from "./types";

export type SourceProps = SourceSpecification & {
  id?: string;
  children?: React.ReactNode;
};

/** Everything except the props this adapter adds is the style-spec source. */
const toSourceSpec = (props: SourceProps): SourceSpecification => {
  const spec: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key !== "id" && key !== "children") {
      spec[key] = value;
    }
  }

  return spec as unknown as SourceSpecification;
};

/**
 * The part of the spec that decides how the source itself is built — clustering,
 * line metrics, tile URLs, zoom limits. MapLibre has no setter for any of them:
 * they are read once, when the source is constructed. `data` is excluded because
 * `GeoJSONSource.setData` does reconcile it in place.
 */
const toSourceOptions = (props: SourceProps): Record<string, unknown> => {
  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key !== "id" && key !== "children" && key !== "data") {
      options[key] = value;
    }
  }

  return options;
};

/**
 * Removes the layers React added on top of this source, and only those. Walking
 * `getLayersOrder()` rather than serialising the whole style through `getStyle()`
 * keeps this off the hot path and, more importantly, keeps it from tearing down
 * layers that the style document declared against the same source.
 */
const sweepRegisteredLayers = (map: MapRef, registered: ReadonlySet<string>): void => {
  if (registered.size === 0) {
    return;
  }

  for (const layerId of map.getLayersOrder()) {
    if (registered.has(layerId) && map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
};

export const Source = (props: SourceProps): React.JSX.Element | null => {
  const propsRef = useLatestRef(props);
  const map = useAttachedMap();
  const styleVersion = useStyleVersion(map);
  const id = useGeneratedId("jsx-source", props.id);
  const layerIdsRef = React.useRef<Set<string>>(new Set());
  // The options the live source was built from, or null while it is not on the
  // map. Doubles as the "nothing to reconcile against yet" signal.
  const appliedOptionsRef = React.useRef<Record<string, unknown> | null>(null);
  // Monotonic: never reset, so a teardown followed by a re-add in the same
  // effect flush still reads as a change to the layers watching it.
  const [generation, setGeneration] = React.useState(0);

  const registerLayer = React.useCallback((layerId: string) => {
    layerIdsRef.current.add(layerId);
  }, []);
  const unregisterLayer = React.useCallback((layerId: string) => {
    layerIdsRef.current.delete(layerId);
  }, []);

  // Adding is separate from removing: `styleVersion` re-adds a source that a
  // style reload dropped, but must never tear down a healthy one.
  React.useEffect(() => {
    if (!isStyleUsable(map)) {
      return;
    }

    if (map.getSource(id)) {
      // Already there — a style that declares it, or a StrictMode replay that
      // has not torn it down yet. Claim it once so layers can mount.
      if (appliedOptionsRef.current === null) {
        appliedOptionsRef.current = toSourceOptions(propsRef.current);
        setGeneration((current) => current + 1);
      }

      return;
    }

    map.addSource(id, toSourceSpec(propsRef.current));
    appliedOptionsRef.current = toSourceOptions(propsRef.current);
    setGeneration((current) => current + 1);
  }, [map, id, styleVersion, propsRef]);

  React.useEffect(() => {
    if (!map) {
      return;
    }

    // The set itself never changes identity, so the cleanup reads the same
    // registry the layers wrote into, whenever it happens to run.
    const registered = layerIdsRef.current;

    return () => {
      appliedOptionsRef.current = null;
      if (!isStyleUsable(map) || !map.getSource(id)) {
        return;
      }

      // React destroys a deleted subtree parent-first, so the layers React added
      // on this source are still there and still have to go before it does.
      sweepRegisteredLayers(map, registered);
      map.removeSource(id);
    };
  }, [map, id]);

  // Declared after the add effect so the first commit adds before it reconciles.
  // `props` in the dependencies means "after every render", stated explicitly:
  // a source option can change without any other signal that it did.
  React.useEffect(() => {
    const applied = appliedOptionsRef.current;
    if (applied === null || !isStyleUsable(map)) {
      return;
    }

    const next = toSourceOptions(props);
    if (deepEqual(applied, next)) {
      return;
    }

    // None of these have a setter, so the source is rebuilt. Its layers are
    // swept first (MapLibre refuses to remove a source still in use) and re-add
    // themselves off the bumped generation, which React flushes before paint.
    appliedOptionsRef.current = next;
    sweepRegisteredLayers(map, layerIdsRef.current);
    map.removeSource(id);
    map.addSource(id, toSourceSpec(props));
    setGeneration((current) => current + 1);
  }, [map, id, props]);

  const data = props.type === "geojson" ? props.data : undefined;

  React.useEffect(() => {
    // A geojson source can be declared without `data`; `setData(undefined)` is
    // not a way to say "leave it alone", so nothing is sent at all.
    if (generation === 0 || data === undefined || data === null || !isStyleUsable(map)) {
      return;
    }

    const source = map.getSource(id);
    if (source instanceof gl.GeoJSONSource) {
      // MapLibre 6 made `setData` asynchronous (it no longer returns the source
      // to chain off). Load failures are reported through the map's own `error`
      // event rather than by rejecting, so there is nothing here to await or
      // recover from — the catch only stops a rejection escaping the effect.
      source.setData(data).catch((error: unknown) => {
        console.error(error);
      });
    }
  }, [generation, map, id, data]);

  const attachment = React.useMemo<SourceAttachment | null>(
    () => (generation === 0 ? null : { id, generation, registerLayer, unregisterLayer }),
    [generation, id, registerLayer, unregisterLayer],
  );

  // Layers are mounted only once the source exists, so their own effects — which
  // React runs after this one — can always find it.
  if (!attachment) {
    return null;
  }

  return <SourceContext.Provider value={attachment}>{props.children}</SourceContext.Provider>;
};
