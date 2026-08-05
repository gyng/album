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
  | "dark"
  | "watercolour"
  | "monochrome"
  | "neon"
  | "halftone"
  | "paper"
  | "crt"
  | "globe"
  | "photos"
  | "blueprint"
  | "herbarium";

/**
 * Which half of the picker a style belongs to.
 *
 * Eighteen names in one list is a list nobody reads to the end of. The split is
 * the one that matters to a reader deciding: a basemap somebody else drew, or
 * one this site made.
 */
export type MapStyleGroup = "provider" | "made-here";

/**
 * Where a style's tiles come from.
 *
 * `free` is OpenFreeMap's own catalogue and `self` a style document this site
 * serves from `public/`. Neither costs anything, needs a credential, or can be
 * rate-limited out from under the site — which is the point: there is no
 * metered provider here any more, so no basemap can go dark because a quota ran
 * out or a key was restricted to somebody else's domain.
 */
type StyleSource =
  | { provider: "free"; id: OpenFreeMapStyleId }
  | { provider: "self"; path: string }
  /** One document per theme, chosen by whichever the page is wearing. */
  | { provider: "themed" };

/**
 * Each choice's source and the label the picker shows. Curated rather than
 * exhaustive: a list two dozen long is a worse control than a short one that
 * covers the actual reasons to switch — a plainer map, a darker one, or
 * something made here.
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
    label: "Theme colours",
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
  dark: {
    source: { provider: "free", id: "dark" },
    label: "Dark",
    swatch: "#1b1f24",
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
  // A plan of the place rather than a picture of it: linework in white on
  // cyanotype, ruled like a draughtsman's paper.
  blueprint: {
    source: { provider: "self", path: "/map-styles/blueprint.json" },
    label: "Blueprint",
    swatch: "#0d2b4d",
    group: "made-here",
  },
  // A pressed sheet: paper with tooth, and the greens as the specimen.
  herbarium: {
    source: { provider: "self", path: "/map-styles/herbarium.json" },
    label: "Herbarium",
    swatch: "#efe7d2",
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

/**
 * What the picker offers. The gallery style is hidden unless this fork actually
 * owns one — eight labels that all render the same basemap is a worse control
 * than seven that differ.
 */
export const MAP_STYLE_NAMES = Object.keys(MAP_STYLES) as MapStyleName[];

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
  // paper tint. Sketch is this site's own hand-made answer to a painterly
  // theme, and herbarium has a sheet of its own.
  watercolour: "sketch",
  herbarium: "herbarium",
  bling: "neon",
  // The plan and the palette are the same cool blue.
  slate: "blueprint",
  // The rest have no map of their own, but they do have a palette — and the
  // themed basemap is the gallery's cartography wearing exactly that. A
  // decorative theme opens on the map that is wearing it.
  ember: "theme",
  arcana: "theme",
  desktop: "theme",
};

/**
 * The map this theme brings with it, or null where it brings none.
 *
 * Separate from the default below because the two questions differ: the world
 * map wants "what do I open on", and a map embedded in a page wants "does this
 * theme have a map of its own, or should I keep the one I chose".
 */
export const themeMapStyle = (theme: ThemeName | null | undefined): MapStyleName | null => {
  const themed = theme ? THEME_MAP_STYLES[theme] : undefined;
  return themed && MAP_STYLE_NAMES.includes(themed) ? themed : null;
};

export const defaultMapStyleForTheme = (theme: ThemeName | null | undefined): MapStyleName =>
  themeMapStyle(theme) ?? DEFAULT_MAP_STYLE;

/**
 * The choice that is not a basemap: whatever the theme suggests.
 *
 * Nothing stored has always meant this, and a reader could see the theme's map
 * but never ask for it back once they had picked something. So it is a choice of
 * its own now — stored like any other, and the one the picker starts on.
 */
export const AUTO_MAP_STYLE = "auto";

/** What the picker holds: a basemap, or the instruction to follow the theme. */
export type MapStyleChoice = MapStyleName | typeof AUTO_MAP_STYLE;

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

export const resolveMapStyleChoice = (value: unknown): MapStyleChoice | null =>
  value === AUTO_MAP_STYLE ? AUTO_MAP_STYLE : resolveMapStyleName(value);

/** The basemap a choice actually loads, which for `auto` is the theme's. */
export const mapStyleForChoice = (
  choice: MapStyleChoice,
  theme: ThemeName | null | undefined,
): MapStyleName => (choice === AUTO_MAP_STYLE ? defaultMapStyleForTheme(theme) : choice);

export const mapStyleUrl = (name: MapStyleName, theme: ThemeName = "light"): string => {
  const { source } = MAP_STYLES[name];
  if (source.provider === "free") return openFreeMapStyleUrl(source.id);
  if (source.provider === "self") return source.path;
  return `/map-styles/theme-${theme}.json`;
};

const readStored = (): MapStyleChoice | null => {
  try {
    return resolveMapStyleChoice(localStorage.getItem(MAP_STYLE_STORAGE_KEY));
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
let current: MapStyleChoice | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((listener) => {
    listener();
  });
};

/**
 * The reader's own choice, or null where they have never made one. Both nothing
 * stored and a stored `auto` mean the same thing to a caller that knows the
 * theme; the difference is only that one of them was asked for.
 */
export const getStoredMapStyleChoice = (): MapStyleChoice | null => {
  if (current === null) {
    current = readStored();
  }

  return current;
};

/** For callers with no theme to consult: `auto` resolves to the default. */
export const getMapStyleName = (): MapStyleName => {
  const stored = getStoredMapStyleChoice();
  return stored === null || stored === AUTO_MAP_STYLE ? DEFAULT_MAP_STYLE : stored;
};

/** The server has no preference to read, and must render the default. */
export const getServerMapStyleName = (): MapStyleName => DEFAULT_MAP_STYLE;

export const setMapStyleChoice = (choice: MapStyleChoice): void => {
  current = choice;
  try {
    localStorage.setItem(MAP_STYLE_STORAGE_KEY, choice);
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

    // Null stays null: another tab clearing the preference puts this one back
    // on the theme's map, not on the configured default.
    const next = readStored();
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
