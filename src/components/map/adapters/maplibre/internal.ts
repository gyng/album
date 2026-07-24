import React from "react";
import type { MapRef } from "./types";

/**
 * Whether the map can still take style mutations. React destroys a parent's
 * effects before its children's, so a `<Source>` or `<Layer>` cleanup can run
 * after `<MapView>` has already removed the map.
 *
 * This reads two properties MapLibre marks internal — `map._removed` and
 * `map.style._loaded` — because it has no public equivalent: `map.loaded()`
 * also waits for tiles, and `map.isStyleLoaded()` throws once the map is gone.
 * Both are declared in MapLibre's own `.d.ts`, so a rename is a type error
 * rather than a silent one, and `internal.test.ts` pins the behaviour.
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

/** `useId` returns a token full of punctuation; style-spec ids read better without it. */
const toIdFragment = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, "");

/**
 * The caller's id, or a stable generated one for anonymous sources and layers.
 *
 * `React.useId` rather than a module-level counter: a counter is mutated during
 * render, so a render React abandons (or replays under concurrent rendering)
 * burns an id, and two components can end up disagreeing about which id each of
 * them owns.
 */
export const useGeneratedId = (prefix: string, id: string | undefined): string => {
  const generated = React.useId();

  return id ?? `${prefix}-${toIdFragment(generated)}`;
};

/**
 * The latest committed props, for effects and long-lived event listeners to read.
 *
 * Written from an effect rather than during render: a render React abandons must
 * not be able to publish props that were never committed, or a listener
 * registered once — a marker's `click`, say — would act on a state the reader
 * never saw. Hooks run in call order, so calling this first in a component
 * guarantees the ref is current before any of that component's other effects.
 */
export const useLatestRef = <T>(value: T): React.RefObject<T> => {
  const ref = React.useRef(value);

  React.useEffect(() => {
    ref.current = value;
  });

  return ref;
};
