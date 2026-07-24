import React from "react";
import type { MapRef } from "./types";

export type MapContextValue = {
  map: MapRef;
};

export const MapContext = React.createContext<MapContextValue | null>(null);

/**
 * What an enclosing `<Source>` tells its layers.
 *
 * More than the id, because a style rebuild wipes sources and layers together
 * and React flushes passive effects child-first: on the commit that follows a
 * `styledata`, a `<Layer>` would otherwise re-add itself against a style whose
 * sources are gone, MapLibre would reject it as `source "x" not found`, and the
 * layer would stay missing until some later style event happened to re-run the
 * effect. `generation` is bumped only once the source is back, so a layer's
 * re-add is scheduled on a *later* commit than its source's.
 */
export type SourceAttachment = {
  /** The style-spec id a layer should attach to. */
  id: string;
  /** Bumped every time the source is added, so layers re-add after it. */
  generation: number;
  /**
   * A layer announces itself so the source can sweep exactly what React put
   * there, and never a layer the style document declared itself.
   */
  registerLayer: (layerId: string) => void;
  unregisterLayer: (layerId: string) => void;
};

/**
 * The source a `<Layer>` belongs to, supplied by the enclosing `<Source>` so
 * layers do not have to name it. A layer may still set `source` explicitly.
 */
export const SourceContext = React.createContext<SourceAttachment | null>(null);

/**
 * The enclosing `<Source>`'s generation, or `0` outside one.
 *
 * Exposed because the generation is the only signal that the source's layers
 * have just been put back on the map: a rebuild for an option MapLibre reads
 * once, or a whole style reloaded underneath. Anything that has to run *after*
 * a re-add — restacking, above all, since a provider appends what it is handed
 * — watches this rather than trying to hear the re-add itself.
 */
export const useSourceGeneration = (): number => React.useContext(SourceContext)?.generation ?? 0;

/** Internal accessor — returns null outside a map, so children stay harmless. */
export const useMapContext = (): MapContextValue | null => React.useContext(MapContext);

/** The map a child is attached to, or null while there is none. */
export const useAttachedMap = (): MapRef | null => useMapContext()?.map ?? null;
