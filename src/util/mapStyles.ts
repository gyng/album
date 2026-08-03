/**
 * The basemaps the reader can choose between, and the preference that remembers
 * which one they picked.
 *
 * All of them come from the same provider and the same key, so switching adds no
 * new third party, no new credential, and no new attribution burden — each style
 * carries its own attribution, which the map already renders from whatever style
 * is loaded.
 *
 * Framework-neutral on purpose: the map screens are part of the portable graph,
 * so this reads `localStorage` defensively and imports only authored
 * configuration.
 */

import { siteConfig } from "../lib/siteConfig";

/**
 * Public, referrer-restricted MapTiler key. Not a secret, but it is restricted
 * on MapTiler's side to one domain, so a fork must supply its own or the map
 * fails silently on theirs. An empty key means "no provider configured", which
 * degrades to a keyless basemap rather than to a blank map.
 */
export const MAP_TILER_KEY = siteConfig.map.apiKey;

export const hasMapProvider = MAP_TILER_KEY.length > 0;

/**
 * OpenFreeMap: keyless, unmetered, and the same OpenMapTiles schema the paid
 * provider serves. Where it has a style that does the job, it is the one used —
 * a metered key is worth spending only on what nobody gives away.
 */
const OPEN_FREE_MAP_HOST = "https://tiles.openfreemap.org/styles";

export type OpenFreeMapStyleId = "liberty" | "bright" | "positron" | "dark" | "fiord";

export const openFreeMapStyleUrl = (id: OpenFreeMapStyleId): string =>
  `${OPEN_FREE_MAP_HOST}/${id}`;

/** Keyless public basemap used when no provider key is configured. */
export const FALLBACK_STYLE_URL = openFreeMapStyleUrl("liberty");

/**
 * The gallery's own MapTiler style, which is scoped to the account that created
 * it. A fork with a perfectly valid key of its own still gets a 403 from
 * someone else's style id, so when none is configured this falls back to a
 * catalogue style and the choice disappears from the picker below.
 */
const GALLERY_STYLE_ID = siteConfig.map.galleryStyleId;

export type MapStyleName =
  | "3d"
  | "gallery"
  | "streets"
  | "outdoor"
  | "topographic"
  | "dark"
  | "satellite"
  | "watercolour"
  | "monochrome";

/**
 * Where a style's tiles come from.
 *
 * `free` styles cost nothing and cannot be rate-limited out from under the
 * site; `keyed` ones are the metered provider's, kept for what the free one
 * does not offer — imagery, terrain, and the fork's own design.
 */
type StyleSource = { provider: "free"; id: OpenFreeMapStyleId } | { provider: "keyed"; id: string };

/**
 * Each choice's MapTiler style id and the label the picker shows. Curated rather
 * than exhaustive: the provider publishes a couple of dozen, and a list that
 * long is a worse control than a short one that covers the actual reasons to
 * switch — a plainer map, a topographic one, a dark one, imagery, or something
 * decorative.
 */
const STREETS_STYLE_ID = "streets-v2";

/**
 * Kept a total `Record` even when the gallery style is unavailable: making it
 * partial would ripple `Partial<>` through every consumer. An unconfigured
 * gallery style therefore resolves to the streets id, so a stale stored
 * preference renders a working map instead of a 403.
 */
export const MAP_STYLES: Record<MapStyleName, { source: StyleSource; label: string }> = {
  // The default first, then the rest. `liberty` is the one OpenFreeMap style
  // that carries a fill-extrusion layer, so a pitched camera over it stands the
  // buildings up — which is the whole of what "3D" means here.
  "3d": { source: { provider: "free", id: "liberty" }, label: "3D" },
  gallery: {
    source: { provider: "keyed", id: GALLERY_STYLE_ID ?? STREETS_STYLE_ID },
    label: "Gallery",
  },
  streets: { source: { provider: "free", id: "bright" }, label: "Streets" },
  outdoor: { source: { provider: "keyed", id: "outdoor-v2" }, label: "Outdoor" },
  topographic: { source: { provider: "keyed", id: "topo-v2" }, label: "Topographic" },
  dark: { source: { provider: "free", id: "dark" }, label: "Dark" },
  satellite: { source: { provider: "keyed", id: "satellite" }, label: "Satellite" },
  watercolour: { source: { provider: "keyed", id: "aquarelle" }, label: "Watercolour" },
  monochrome: { source: { provider: "free", id: "positron" }, label: "Monochrome" },
};

/** True where a style needs no key and no quota. */
export const isFreeMapStyle = (name: MapStyleName): boolean =>
  MAP_STYLES[name].source.provider === "free";

/**
 * What the picker offers. The gallery style is hidden unless this fork actually
 * owns one — eight labels that all render the same basemap is a worse control
 * than seven that differ.
 */
export const MAP_STYLE_NAMES = (Object.keys(MAP_STYLES) as MapStyleName[]).filter(
  (name) =>
    (name !== "gallery" || GALLERY_STYLE_ID !== null) &&
    // A keyed style with no key renders the keyless fallback, so offering it
    // would be several labels for one basemap.
    (isFreeMapStyle(name) || hasMapProvider),
);

const isAvailableStyleName = (value: string): value is MapStyleName =>
  (MAP_STYLE_NAMES as string[]).includes(value);

export const DEFAULT_MAP_STYLE: MapStyleName = isAvailableStyleName(siteConfig.map.defaultStyle)
  ? siteConfig.map.defaultStyle
  : "3d";

export const MAP_STYLE_STORAGE_KEY = "mapStyle";

export const resolveMapStyleName = (value: unknown): MapStyleName | null => {
  if (typeof value !== "string") {
    return null;
  }

  // "default" was this preference's first name for the gallery's own style, back
  // when it was also the default. Readers who chose it deliberately keep it.
  const name = value === "default" ? "gallery" : value;

  // Checked against the available names, not the full record, so a stored
  // "gallery" from before a fork removed its style id is rejected rather than
  // silently resolving to something else.
  return isAvailableStyleName(name) ? name : null;
};

/**
 * Every MapTiler style URL in the application is built here — the one place the
 * key and the provider's host appear. `styleId` is a raw provider style id, for
 * callers that pick from the provider catalogue rather than the curated list.
 */
export const mapTilerStyleUrl = (styleId: string, key: string = MAP_TILER_KEY): string =>
  key ? `https://api.maptiler.com/maps/${styleId}/style.json?key=${key}` : FALLBACK_STYLE_URL;

export const mapStyleUrl = (name: MapStyleName, key: string = MAP_TILER_KEY): string => {
  const { source } = MAP_STYLES[name];
  return source.provider === "free"
    ? openFreeMapStyleUrl(source.id)
    : mapTilerStyleUrl(source.id, key);
};

/**
 * Whether this style stands its buildings up, which is only worth pitching the
 * camera for where the style actually draws them.
 */
export const isPitchedMapStyle = (name: MapStyleName): boolean => name === "3d";

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
