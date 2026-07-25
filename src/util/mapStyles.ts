/**
 * The basemaps the reader can choose between, and the preference that remembers
 * which one they picked.
 *
 * All of them come from the same provider and the same key as the default map,
 * so switching adds no new third party, no new credential, and no new
 * attribution burden — each style carries its own attribution, which the map
 * already renders from whatever style is loaded.
 *
 * Framework-neutral on purpose: the map screens are part of the portable graph,
 * so this reads `localStorage` defensively and imports nothing.
 */

/**
 * Public, domain-restricted MapTiler key — the same one the default style has
 * always used. Not a secret; restricted on MapTiler's side by referrer.
 */
export const MAP_TILER_KEY = "iilC4hPY1594noPX9OQ2";

/** The gallery's own MapTiler style, and the default. */
const DEFAULT_STYLE_ID = "ffd8bd10-cd97-40a5-b1d6-d15f98fb3644";

export type MapStyleName =
  | "default"
  | "streets"
  | "outdoor"
  | "topographic"
  | "dark"
  | "satellite"
  | "watercolour"
  | "monochrome";

/**
 * Each choice's MapTiler style id and the label the picker shows. Curated rather
 * than exhaustive: the provider publishes a couple of dozen, and a list that
 * long is a worse control than a short one that covers the actual reasons to
 * switch — a plainer map, a topographic one, a dark one, imagery, or something
 * decorative.
 */
export const MAP_STYLES: Record<MapStyleName, { id: string; label: string }> = {
  default: { id: DEFAULT_STYLE_ID, label: "Gallery" },
  streets: { id: "streets-v2", label: "Streets" },
  outdoor: { id: "outdoor-v2", label: "Outdoor" },
  topographic: { id: "topo-v2", label: "Topographic" },
  dark: { id: "dataviz-dark", label: "Dark" },
  satellite: { id: "satellite", label: "Satellite" },
  watercolour: { id: "aquarelle", label: "Watercolour" },
  monochrome: { id: "toner-v2", label: "Monochrome" },
};

export const MAP_STYLE_NAMES = Object.keys(MAP_STYLES) as MapStyleName[];

export const DEFAULT_MAP_STYLE: MapStyleName = "default";

export const MAP_STYLE_STORAGE_KEY = "mapStyle";

export const resolveMapStyleName = (value: unknown): MapStyleName | null =>
  typeof value === "string" && value in MAP_STYLES ? (value as MapStyleName) : null;

export const mapStyleUrl = (name: MapStyleName, key: string = MAP_TILER_KEY): string =>
  `https://api.maptiler.com/maps/${MAP_STYLES[name].id}/style.json?key=${key}`;

const readStored = (): MapStyleName | null => {
  try {
    return resolveMapStyleName(localStorage.getItem(MAP_STYLE_STORAGE_KEY));
  } catch {
    // Private-mode or blocked storage: fall back to the default rather than
    // taking the map down.
    return null;
  }
};

/* -------------------------------------------------------------------------- */
/* The preference, as a store                                                  */
/* -------------------------------------------------------------------------- */

// The picker and the map are in the same document but not the same subtree, and
// a `localStorage` write fires no event in the tab that made it. So the
// preference is a small external store: subscribers are notified directly, and
// the `storage` event folds in changes made in another tab.
let current: MapStyleName | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((listener) => {
    listener();
  });
};

export const getMapStyleName = (): MapStyleName => {
  if (current === null) {
    current = readStored() ?? DEFAULT_MAP_STYLE;
  }

  return current;
};

/** The server has no preference to read, and must render the default. */
export const getServerMapStyleName = (): MapStyleName => DEFAULT_MAP_STYLE;

export const setMapStyleName = (name: MapStyleName): void => {
  current = name;
  try {
    localStorage.setItem(MAP_STYLE_STORAGE_KEY, name);
  } catch {
    // The choice still applies to this session even if it cannot be kept.
  }
  notify();
};

export const subscribeMapStyleName = (listener: () => void): (() => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== MAP_STYLE_STORAGE_KEY) {
      return;
    }

    const next = readStored() ?? DEFAULT_MAP_STYLE;
    if (next !== current) {
      current = next;
      notify();
    }
  };

  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

/** Test seam: forget the cached preference so the next read consults storage. */
export const resetMapStyleCache = (): void => {
  current = null;
};
