import React from "react";
import { useMapContext } from "./context";
import type { MapRef } from "./types";

/**
 * Matches the call sites we already have: `const { current: map } = useMap()`.
 * `current` is `undefined` until the map has finished loading, and outside a
 * `<MapView>` entirely, so every consumer already guards on it.
 */
export type MapCollection = {
  current: MapRef | undefined;
};

export const useMap = (): MapCollection => {
  const context = useMapContext();
  const map = context?.map;

  return React.useMemo(() => ({ current: map }), [map]);
};
