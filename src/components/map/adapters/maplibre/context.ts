import React from "react";
import type { MapRef } from "./types";

export type MapContextValue = {
  map: MapRef;
};

export const MapContext = React.createContext<MapContextValue | null>(null);

/**
 * The source a `<Layer>` belongs to, supplied by the enclosing `<Source>` so
 * layers do not have to name it. A layer may still set `source` explicitly.
 */
export const SourceIdContext = React.createContext<string | null>(null);

/** Internal accessor — returns null outside a map, so children stay harmless. */
export const useMapContext = (): MapContextValue | null => React.useContext(MapContext);

/** The map a child is attached to, or null while there is none. */
export const useAttachedMap = (): MapRef | null => useMapContext()?.map ?? null;
