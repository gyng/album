import React from "react";
import type { MapRef } from "./types";

/**
 * Whether the map can still take style mutations. React destroys a parent's
 * effects before its children's, so a `<Source>` or `<Layer>` cleanup can run
 * after `<MapView>` has already removed the map.
 */
export const isStyleUsable = (map: MapRef | null): map is MapRef => {
  if (!map || map._removed) {
    return false;
  }

  return Boolean(map.style?._loaded);
};

/**
 * A counter bumped on every `styledata` event, used to re-add sources and
 * layers that a style reload wiped. Deliberately local to each component rather
 * than shared through the map context: MapLibre fires `styledata` on any style
 * mutation, and a shared version would re-render every marker on the map.
 */
export const useStyleVersion = (map: MapRef | null): number => {
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    if (!map) {
      return;
    }

    const onStyleData = () => {
      setVersion((current) => current + 1);
    };

    map.on("styledata", onStyleData);

    return () => {
      map.off("styledata", onStyleData);
    };
  }, [map]);

  return version;
};

/** Structural comparison for style-spec values (expressions are plain arrays). */
export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const leftKeys = Object.keys(left);

    return (
      leftKeys.length === Object.keys(right).length &&
      leftKeys.every((key) => deepEqual(left[key], right[key]))
    );
  }

  return false;
};

let idCounter = 0;

/** The caller's id, or a stable generated one for anonymous sources and layers. */
export const useGeneratedId = (prefix: string, id: string | undefined): string => {
  const generated = React.useRef<string | null>(null);
  if (generated.current === null) {
    idCounter += 1;
    generated.current = `${prefix}-${idCounter}`;
  }

  return id ?? generated.current;
};
