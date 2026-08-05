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
import type { ThemeName } from "./theme";

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

export type MapStyleName =
  | "theme"
  | "3d"
  | "gallery"
  | "minimal"
  | "sketch"
  | "streets"
  | "outdoor"
  | "topographic"
  | "dark"
  | "satellite"
  | "watercolour"
  | "monochrome"
  | "neon"
  | "halftone"
  | "paper"
  | "crt"
  | "globe"
  | "photos";

/**
 * Where a style's tiles come from.
 *
 * `free` is OpenFreeMap's own catalogue and `self` a style document this site
 * serves from `public/`; neither costs anything or can be rate-limited out from
 * under the site. `keyed` is the metered provider's, kept for what neither of
 * the others offers — imagery, terrain, and decoration.
 */
/**
 * Which half of the picker a style belongs to.
 *
 * Eighteen names in one list is a list nobody reads to the end of. The split is
 * the one that matters to a reader deciding: a basemap somebody else drew, or
 * one this site made.
 */
export type MapStyleGroup = "provider" | "made-here";

type StyleSource =
  | { provider: "free"; id: OpenFreeMapStyleId }
  | { provider: "self"; path: string }
  /** One document per theme, chosen by whichever the page is wearing. */
  | { provider: "themed" }
  | { provider: "keyed"; id: string };

/**
 * Each choice's source and the label the picker shows. Curated rather than
 * exhaustive: a list two dozen long is a worse control than a short one that
 * covers the actual reasons to switch — a plainer map, a topographic one, a
 * dark one, imagery, or something decorative.
 */
export const MAP_STYLES: Record<
  MapStyleName,
  { source: StyleSource; label: string; swatch: string; group: MapStyleGroup }
> = {
  // The default first, then the rest. `liberty` is the one OpenFreeMap style
  // that carries a fill-extrusion layer: it opens flat, like every other
  // basemap here, and stands its buildings up as soon as a reader tilts it.
  // Composed from the same palette the page is using, so the map belongs to
  // the theme rather than sitting on it.
  theme: {
    source: { provider: "themed" },
    label: "Match theme",
    swatch: "var(--c-bg)",
    group: "made-here",
  },
  "3d": {
    source: { provider: "free", id: "liberty" },
    label: "3D",
    swatch: "#e8e3d8",
    group: "provider",
  },
  // Ground, water and the roads that matter, with nothing written on it: the
  // world map draws fourteen hundred pins, and the basemap under them is
  // competing with its own subject.
  minimal: {
    source: { provider: "self", path: "/map-styles/minimal.json" },
    label: "Minimal",
    swatch: "#f7f6f3",
    group: "made-here",
  },
  // Watercolour's sibling: linework on paper, no fills.
  sketch: {
    source: { provider: "self", path: "/map-styles/sketch.json" },
    label: "Sketch",
    swatch: "#f4efe2",
    group: "made-here",
  },
  // The fork's own design, lifted off the metered tiles onto the free ones and
  // served from here: same layers, same paint, same sprite, no key and no
  // quota. `bin/build-free-gallery-style.cjs` regenerates it.
  gallery: {
    source: { provider: "self", path: "/map-styles/gallery.json" },
    label: "Gallery",
    swatch: "#f0ece1",
    group: "made-here",
  },
  streets: {
    source: { provider: "free", id: "bright" },
    label: "Streets",
    swatch: "#f8f4f0",
    group: "provider",
  },
  outdoor: {
    source: { provider: "keyed", id: "outdoor-v2" },
    label: "Outdoor",
    swatch: "#e8efdc",
    group: "provider",
  },
  topographic: {
    source: { provider: "keyed", id: "topo-v2" },
    label: "Topographic",
    swatch: "#e6e0cf",
    group: "provider",
  },
  dark: {
    source: { provider: "free", id: "dark" },
    label: "Dark",
    swatch: "#1b1f24",
    group: "provider",
  },
  satellite: {
    source: { provider: "keyed", id: "satellite" },
    label: "Satellite",
    swatch: "#4a5a46",
    group: "provider",
  },
  // Also lifted onto the free tiles: its landmass came from a tileset of its
  // own, which becomes a background of the same colour, the way OpenFreeMap's
  // own styles draw land.
  watercolour: {
    source: { provider: "self", path: "/map-styles/watercolour.json" },
    label: "Watercolour",
    swatch: "#f7f2e6",
    group: "made-here",
  },
  monochrome: {
    source: { provider: "free", id: "positron" },
    label: "Monochrome",
    swatch: "#ededed",
    group: "provider",
  },
  // The rest are made rather than chosen: each one is a different answer to
  // what a map could be made of.
  //
  // Light. The roads are the only lit thing on it — a wide blurred copy under a
  // thin bright core, which is how a light reads on a photograph.
  neon: {
    source: { provider: "self", path: "/map-styles/neon.json" },
    label: "Neon",
    swatch: "#05060b",
    group: "made-here",
  },
  // Ink. Tone comes from the size of a dot, the way an offset press shades an
  // area, with grain over the whole sheet.
  halftone: {
    source: { provider: "self", path: "/map-styles/halftone.json" },
    label: "Halftone",
    swatch: "#f2e4c4",
    group: "made-here",
  },
  // Card. Every fill drops a shadow, so the map stacks instead of printing.
  paper: {
    source: { provider: "self", path: "/map-styles/paper.json" },
    label: "Paper",
    swatch: "#f6f1e4",
    group: "made-here",
  },
  // Phosphor. Linework only, scanlines over everything.
  crt: {
    source: { provider: "self", path: "/map-styles/crt.json" },
    label: "CRT",
    swatch: "#020604",
    group: "made-here",
  },
  // The colours of the photographs themselves. The indexer stores a dominant
  // palette per photograph, so the site already knows what its own pictures
  // look like; `photoPalette.cjs` reduces the corpus to a ground, a water and
  // an ink, and the gallery's cartography wears them.
  photos: {
    source: { provider: "self", path: "/map-styles/photos.json" },
    label: "From the photographs",
    swatch: "conic-gradient(from 210deg, #b3b3b3, #7f8ea6, #1c1b19, #d5c1b2, #b3b3b3)",
    group: "made-here",
  },
  // A sphere. The projection is the style: MapLibre reads it from the document,
  // so choosing this basemap is what puts the photographs on a planet.
  globe: {
    source: { provider: "self", path: "/map-styles/globe.json" },
    label: "Globe",
    swatch: "#1b2430",
    group: "made-here",
  },
};

/** True where a style needs no key and no quota. */
export const isFreeMapStyle = (name: MapStyleName): boolean =>
  MAP_STYLES[name].source.provider !== "keyed";

/**
 * What the picker offers. The gallery style is hidden unless this fork actually
 * owns one — eight labels that all render the same basemap is a worse control
 * than seven that differ.
 */
export const MAP_STYLE_NAMES = (Object.keys(MAP_STYLES) as MapStyleName[]).filter(
  (name) =>
    // A keyed style with no key renders the keyless fallback, so offering it
    // would be several labels for one basemap.
    isFreeMapStyle(name) || hasMapProvider,
);

/**
 * The picker's contents, in two groups. Order within each is the curated one.
 */
export const MAP_STYLE_GROUPS: Array<{ label: string; names: MapStyleName[] }> = [
  {
    label: "Made here",
    names: MAP_STYLE_NAMES.filter((name) => MAP_STYLES[name].group === "made-here"),
  },
  {
    label: "From the provider",
    names: MAP_STYLE_NAMES.filter((name) => MAP_STYLES[name].group === "provider"),
  },
].filter((group) => group.names.length > 0);

const isAvailableStyleName = (value: string): value is MapStyleName =>
  (MAP_STYLE_NAMES as string[]).includes(value);

export const DEFAULT_MAP_STYLE: MapStyleName = isAvailableStyleName(siteConfig.map.defaultStyle)
  ? siteConfig.map.defaultStyle
  : "3d";

/**
 * The basemap a theme opens with, where one of them is obviously its map.
 *
 * Only a reader who has never chosen a basemap sees these: an explicit choice
 * outranks the theme, and switching theme never overrides it. `light`, `dark`
 * and the rest are deliberately absent — they are the schemes people read in,
 * and a legible default matters more there than a matching one.
 */
const THEME_MAP_STYLES: Partial<Record<ThemeName, MapStyleName>> = {
  terminal: "crt",
  paper: "paper",
  ink: "sketch",
  // Not the watercolour basemap: its defining texture came from a raster
  // tileset this fork does not have, so what is left is a pale map with a
  // paper tint. The gallery style is this site's own cartography, which is a
  // better thing to hand somebody who picked a painterly theme.
  watercolour: "gallery",
  herbarium: "gallery",
  bling: "neon",
  // The rest have no map of their own, but they do have a palette — and the
  // themed basemap is the gallery's cartography wearing exactly that. A
  // decorative theme opens on the map that is wearing it.
  slate: "theme",
  ember: "theme",
  arcana: "theme",
  desktop: "theme",
};

export const defaultMapStyleForTheme = (theme: ThemeName | null | undefined): MapStyleName => {
  const themed = theme ? THEME_MAP_STYLES[theme] : undefined;
  return themed && MAP_STYLE_NAMES.includes(themed) ? themed : DEFAULT_MAP_STYLE;
};

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

export const mapStyleUrl = (
  name: MapStyleName,
  key: string = MAP_TILER_KEY,
  theme: ThemeName = "light",
): string => {
  const { source } = MAP_STYLES[name];
  if (source.provider === "free") return openFreeMapStyleUrl(source.id);
  if (source.provider === "self") return source.path;
  if (source.provider === "themed") return `/map-styles/theme-${theme}.json`;
  return mapTilerStyleUrl(source.id, key);
};

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

/**
 * The reader's own choice, or null where they have never made one — which is
 * what lets a theme supply the default without overriding a decision.
 */
export const getStoredMapStyleName = (): MapStyleName | null => {
  if (current === null) {
    current = readStored();
  }

  return current;
};

export const getMapStyleName = (): MapStyleName => getStoredMapStyleName() ?? DEFAULT_MAP_STYLE;

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
