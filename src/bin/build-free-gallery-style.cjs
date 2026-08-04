// Rebuilds the gallery basemap as a style this site serves itself.
//
// The design is the fork's own, made in MapTiler Cloud, but every map that
// loads it was a request against a metered key — and when that key hit its
// free-plan limit, every map on the site went blank at once. Both providers
// serve the same OpenMapTiles v3 schema, so the *design* can be lifted off the
// metered tiles and pointed at OpenFreeMap's: same layers, same paint, same
// sprite, no key and no quota.
//
// Run it when the MapTiler style changes:
//   node ./bin/build-free-gallery-style.cjs
//
// It writes public/map-styles/, which is committed — the build itself must not
// depend on a third party being reachable.

const fs = require("node:fs");
const path = require("node:path");
const { siteConfig } = require("./siteConfig.cjs");

const OPEN_FREE_MAP = {
  tiles: "https://tiles.openfreemap.org/planet",
  fonts: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
};

/**
 * Served from this origin, so the sprite is not a third-party request either.
 *
 * The token is filled in at build time by `prepare-map-styles.cjs`: MapLibre
 * rejects a relative sprite URL outright, and the origin is not the same on a
 * laptop, a preview and production.
 */
const SPRITE_PATH = "{{origin}}/map-styles/gallery/sprite";

const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

/**
 * The fonts the free glyph server actually has.
 *
 * It answers for a single font and 404s the comma-joined path MapLibre builds
 * for a stack — even a stack of one font repeated — and a font it cannot fetch
 * is a label that never draws. Everything else is mapped onto one of these by
 * weight, which is a change of typeface and no loss of information.
 */
const AVAILABLE_FONTS = new Set(["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"]);

const resolveFont = (font) => {
  if (AVAILABLE_FONTS.has(font)) return font;
  if (/italic|oblique/i.test(font)) return "Noto Sans Italic";
  if (/bold|black|semi|medium|heavy/i.test(font)) return "Noto Sans Bold";
  return "Noto Sans Regular";
};

/**
 * One font rather than a stack, wherever the style names one.
 *
 * A style can set its font with an expression, so this walks nested arrays —
 * but only ever rewrites an array that is itself a font stack. Recursing into
 * the strings of an expression turned `["get", "class"]` into a typeface.
 */
const isFontStack = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === "string" && item.includes(" "));

const remapFonts = (value) => {
  if (typeof value === "string") return resolveFont(value);
  if (!Array.isArray(value)) return value;
  if (isFontStack(value)) return [resolveFont(value[0])];

  // An expression: its head stays, and only its nested arrays are considered.
  return value.map((item, index) =>
    index === 0 || !Array.isArray(item) ? item : remapFonts(item),
  );
};

/**
 * Source layers the free tiles do not carry.
 *
 * `globallandcover` is MapTiler's own low-zoom landcover wash; OpenFreeMap
 * ships `landcover` and `landuse` but not that one, so those layers would draw
 * nothing and are dropped rather than left to fail quietly.
 */
const UNAVAILABLE_SOURCE_LAYERS = new Set(["globallandcover"]);

/** Rewrites one layer onto the free source, or drops it where it cannot work. */
const rewriteLayer = (layer, sourceName) => {
  if (UNAVAILABLE_SOURCE_LAYERS.has(layer["source-layer"])) return null;

  const next = { ...layer };
  if (next.source) next.source = sourceName;
  if (next.layout?.["text-font"]) {
    next.layout = { ...next.layout, "text-font": remapFonts(next.layout["text-font"]) };
  }
  return next;
};

/**
 * The whole style, repointed.
 *
 * One vector source rather than the provider's pair: the second was a
 * source-less carrier for their attribution, which no longer applies to tiles
 * they are not serving.
 */
const buildFreeStyle = (style, { sourceName = "openmaptiles" } = {}) => {
  const layers = style.layers.map((layer) => rewriteLayer(layer, sourceName)).filter(Boolean);

  return {
    version: 8,
    name: `${style.name ?? "Gallery"} (self-hosted)`,
    sources: {
      [sourceName]: {
        type: "vector",
        url: OPEN_FREE_MAP.tiles,
        attribution: ATTRIBUTION,
      },
    },
    glyphs: OPEN_FREE_MAP.fonts,
    sprite: SPRITE_PATH,
    ...(style.light ? { light: style.light } : {}),
    ...(style.sky ? { sky: style.sky } : {}),
    layers,
  };
};

/* istanbul ignore next -- network and disk; the rewrite above is what is tested */
const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
};

/* istanbul ignore next -- network and disk */
const run = async (log = console.log) => {
  const key = siteConfig.map.apiKey;
  const id = siteConfig.map.galleryStyleId;
  if (!key || !id) throw new Error("No gallery style is configured to copy.");

  const base = `https://api.maptiler.com/maps/${id}`;
  const style = await fetchJson(`${base}/style.json?key=${key}`);
  const outDir = path.join(__dirname, "..", "public", "map-styles");
  const spriteDir = path.join(outDir, "gallery");
  fs.mkdirSync(spriteDir, { recursive: true });

  // The sprite is the style's own icons; served from here it costs the metered
  // provider nothing and cannot go missing when a quota does.
  for (const [name, binary] of [
    ["sprite.json", false],
    ["sprite.png", true],
    ["sprite@2x.png", true],
  ]) {
    const response = await fetch(`${base}/${name}?key=${key}`);
    if (!response.ok) throw new Error(`${response.status} for ${name}`);
    const body = binary
      ? Buffer.from(await response.arrayBuffer())
      : JSON.stringify(await response.json());
    fs.writeFileSync(path.join(spriteDir, name), body);
  }

  const free = buildFreeStyle(style);
  fs.writeFileSync(path.join(outDir, "gallery.template.json"), `${JSON.stringify(free)}\n`);
  log(
    `Wrote ${free.layers.length} layers (from ${style.layers.length}) to public/map-styles/gallery.template.json`,
  );
  return free;
};

module.exports = { buildFreeStyle, remapFonts, resolveFont, rewriteLayer, run };

/* istanbul ignore next -- direct CLI dispatch; run is exercised by hand */
if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
