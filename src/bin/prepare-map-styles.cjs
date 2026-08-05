// Writes the self-hosted basemap style for this deploy.
//
// The style itself is committed as a template; all this does is fill in the
// origin. MapLibre rejects a relative sprite URL outright ("must be absolute"),
// and the origin is not the same on a laptop, a preview and production — so it
// cannot be baked into the committed file.

const fs = require("node:fs");
const path = require("node:path");
const { resolveSiteOrigin } = require("./siteConfig.cjs");
const { composeMapStyle } = require("./composeMapStyle.cjs");
const { tintMapStyle } = require("./tintMapStyle.cjs");
const { THEME_PALETTES } = require("./mapStylePalettes.cjs");
const { buildPatternSheet } = require("./mapPatternSprite.cjs");
const { coloursFromPaletteStrings, paletteFromColours } = require("./photoPalette.cjs");

const ORIGIN_TOKEN = "{{origin}}";

/**
 * The theme basemaps: the gallery style, wearing each theme's palette.
 *
 * Composing a basemap from a table gets the colours right and the cartography
 * approximately — the gallery style has seventy-five layers of casings, shields
 * and icons that a palette table will not reproduce. So the theme styles are
 * that style retinted, which keeps its map and changes its colours.
 *
 * @param {object} gallery the gallery style document, already parsed.
 * @returns {Array<[string, object]>} each style's file name and document.
 */
const themedStyles = (gallery) =>
  Object.entries(THEME_PALETTES).map(
    /** @returns {[string, object]} */
    ([theme, palette]) => [`theme-${theme}`, tintMapStyle(gallery, palette, `Theme (${theme})`)],
  );

/**
 * The basemaps this site composes rather than copies.
 *
 * Not about colour — the themes cover that — but about what a map can be made
 * of: light, printed ink, cut card, a phosphor tube, or a sphere.
 *
 * @param {string} spriteUrl absolute URL of the generated pattern sprite.
 * @returns {Array<[string, object]>} each style's file name and document.
 */
const composedStyles = (spriteUrl) => {
  /** @type {Array<[string, object]>} */
  const styles = [];

  styles.push([
    "minimal",
    composeMapStyle({
      name: "Minimal",
      palette: THEME_PALETTES.light,
      options: { labels: false, buildings: false, landcover: false, roads: "major" },
    }),
  ]);

  styles.push([
    "sketch",
    composeMapStyle({
      name: "Sketch",
      palette: {
        ...THEME_PALETTES.paper,
        water: "#6c7f8c",
        building: "#8d8375",
        road: "#5f5648",
        motorway: "#7d6a4a",
        boundary: "#9a8f7c",
      },
      options: { outlineOnly: true, lineWidthScale: 1.4 },
    }),
  ]);

  // Night drive. The roads are the only lit thing: a wide blurred copy under a
  // thin bright core, which is how a light reads on a photograph. Everything
  // else recedes to nearly black so the photo pins are the signage.
  styles.push([
    "neon",
    composeMapStyle({
      name: "Neon",
      palette: {
        land: "#05060b",
        water: "#04070f",
        green: "#070c12",
        built: "#080910",
        road: "#7df9ff",
        roadCasing: "#0b1020",
        motorway: "#ff4ecd",
        building: "#0c1020",
        boundary: "#1d2b45",
        label: "#8bd6ff",
        labelHalo: "#02030699",
      },
      options: {
        landcover: false,
        // Every road, not only the big ones: a night drive is the whole grid
        // lit, and "major" left a city as five streets in the dark.
        roads: "all",
        lineWidthScale: 0.55,
        glow: { colour: "#00b7ff", blur: 10, opacity: 0.42, width: 1.4 },
        // The one thing a night map has to have from orbit: an edge where the
        // land stops. Without it the world view was black with country names
        // floating on it.
        coast: { colour: "#1d4f6b", width: 1.6, opacity: 0.95 },
      },
    }),
  ]);

  // A printed map, 1974: two inks, a dot screen for tone, and grain over the
  // whole sheet. The screen is what makes it a print rather than a palette —
  // areas are shaded by dot size, the way an offset press shades them.
  styles.push([
    "halftone",
    composeMapStyle({
      name: "Halftone",
      palette: {
        land: "#f2e4c4",
        water: "#9fc0c4",
        green: "#c8cf9c",
        built: "#e6d3ad",
        road: "#fdf6e6",
        roadCasing: "#b6906a",
        motorway: "#e2894f",
        building: "#d9c199",
        boundary: "#a8794f",
        label: "#5a3a20",
        labelHalo: "#f2e4c4cc",
      },
      options: {
        roads: "all",
        spriteUrl,
        // A finer screen on the water — the coarse one read as polka dots at
        // street zoom — and a visible one on the land, which is what makes the
        // ground look printed rather than filled.
        // Held back to street scale: at world scale the dots are the size of
        // countries and the sea reads as polka dots.
        screen: { land: "dot-fine", water: "dot-fine", minzoom: 6 },
        overlay: { id: "grain", opacity: 0.6 },
      },
    }),
  ]);

  // Cut card. Every fill drops a shadow two pixels down and right, so the map
  // stacks: water under land, buildings above both, and the paper grain over
  // all of it holds the whole thing together as one sheet.
  styles.push([
    "paper",
    composeMapStyle({
      name: "Paper",
      palette: {
        land: "#f6f1e4",
        water: "#bcd3d8",
        green: "#cfdcb8",
        built: "#ece2cf",
        road: "#fffdf7",
        roadCasing: "#ded2b8",
        motorway: "#f0d2a0",
        building: "#e7dcc4",
        boundary: "#c0b193",
        label: "#4b4030",
        labelHalo: "#f6f1e4cc",
      },
      options: {
        roads: "all",
        shadow: 3,
        spriteUrl,
        overlay: { id: "grain", opacity: 0.35 },
      },
    }),
  ]);

  // A tube, not a map. Linework only, in phosphor, with scanlines over
  // everything — the one style where drawing no fills is the whole point.
  styles.push([
    "crt",
    composeMapStyle({
      name: "CRT",
      palette: {
        land: "#020604",
        water: "#12c47a",
        green: "#12c47a",
        built: "#12c47a",
        road: "#1fd987",
        roadCasing: "#12c47a",
        motorway: "#7bf06a",
        building: "#0b6b48",
        boundary: "#12c47a",
        label: "#9dffcd",
        labelHalo: "#020604cc",
      },
      options: {
        outlineOnly: true,
        roads: "all",
        lineWidthScale: 0.8,
        spriteUrl,
        overlay: { id: "scanline-soft", opacity: 0.6 },
      },
    }),
  ]);

  // The world as a world. Nothing is drawn that a globe cannot carry at the
  // zoom you look at a globe from: ground, water, coast and the biggest names.
  styles.push([
    "globe",
    composeMapStyle({
      name: "Globe",
      palette: {
        ...THEME_PALETTES.dark,
        land: "#3b4d5e",
        water: "#050d16",
        road: "#4a5c6e",
        roadCasing: "#22303c",
        motorway: "#6b7f92",
        boundary: "#44586b",
        label: "#dbe8f4",
        labelHalo: "#060f1acc",
      },
      options: {
        projection: "globe",
        // Drawn for the world it opens on, and still a map if a reader keeps
        // going: from orbit these add nothing, and up close their absence was
        // an empty screen.
        landcover: true,
        buildings: true,
        roads: "all",
        lineWidthScale: 0.6,
        sky: { sky: "#03070d", horizon: "#2f6ea8", atmosphere: 0.85 },
      },
    }),
  ]);

  return styles;
};

/**
 * The palette of the photographs themselves, out of the search database.
 *
 * Best-effort by construction: a fork with no index yet, and the E2E build with
 * its fixture databases, both get null and the basemap keeps a default palette
 * rather than the build failing over a colour scheme.
 */
/* istanbul ignore next -- disk and SQLite; paletteFromColours is what is tested */
const photographPalette = (log) => {
  const dbPath = path.join(__dirname, "..", "public", "search.sqlite");
  if (!fs.existsSync(dbPath)) return null;

  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare("SELECT colors FROM images WHERE colors IS NOT NULL")
      .all()
      .map((row) => row.colors);
    db.close();
    return paletteFromColours(coloursFromPaletteStrings(rows));
  } catch (error) {
    log(`Could not read photograph colours (${error.message}); using the default palette.`);
    return null;
  }
};

/** Replaces every origin token; returns the document untouched when there is none. */
const applyOrigin = (template, origin) => template.split(ORIGIN_TOKEN).join(origin);

/**
 * Writes the pattern sprite the printed styles draw their ink from.
 *
 * MapLibre wants a PNG and an index beside it, and refuses a relative sprite
 * URL, so this returns the absolute one the styles are given.
 */
/* istanbul ignore next -- disk and an encoder; the sheet itself is tested */
const writePatternSprite = (dir, origin) => {
  const sheet = buildPatternSheet();
  const target = path.join(dir, "patterns");
  fs.mkdirSync(target, { recursive: true });

  fs.writeFileSync(path.join(target, "sprite.json"), `${JSON.stringify(sheet.index)}\n`);
  const sharp = require("sharp");
  return sharp(Buffer.from(sheet.pixels.buffer), {
    raw: { width: sheet.width, height: sheet.height, channels: 4 },
  })
    .png()
    .toFile(path.join(target, "sprite.png"))
    .then(() => `${origin}/map-styles/patterns/sprite`);
};

/* istanbul ignore next -- disk; applyOrigin is what is tested */
const run = async (log = console.log, env = process.env) => {
  const dir = path.join(__dirname, "..", "public", "map-styles");
  if (!fs.existsSync(dir)) {
    log("No self-hosted map styles; nothing to prepare.");
    return [];
  }

  const origin = resolveSiteOrigin(env);

  // The theme basemaps are the gallery style retinted. They are generated, not
  // committed, so the origin is filled in here rather than by leaving twelve
  // more templates on disk.
  const gallery = JSON.parse(fs.readFileSync(path.join(dir, "gallery.template.json"), "utf8"));
  for (const [name, style] of themedStyles(gallery)) {
    fs.writeFileSync(
      path.join(dir, `${name}.json`),
      `${applyOrigin(JSON.stringify(style), origin)}\n`,
    );
  }

  // The basemap that wears the colours of the photographs on it. Falls back to
  // the paper palette, so the style always exists and the picker never offers a
  // choice that 404s.
  const photographs = photographPalette(log);
  fs.writeFileSync(
    path.join(dir, "photos.json"),
    `${applyOrigin(
      JSON.stringify(
        tintMapStyle(
          gallery,
          photographs ?? { land: "#f4efe2", water: "#cfdfe0", label: "#4a4030" },
          "From the photographs",
        ),
      ),
      origin,
    )}\n`,
  );
  if (photographs) {
    log(
      `Photograph palette: ground ${photographs.land}, water ${photographs.water}, ink ${photographs.label}`,
    );
  }

  const spriteUrl = await writePatternSprite(dir, origin);

  // Composed styles have no template to fill in: they are built from a palette
  // here, so a basemap is a table entry rather than a committed document.
  for (const [name, style] of composedStyles(spriteUrl)) {
    fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(style)}\n`);
  }

  const templates = fs.readdirSync(dir).filter((name) => name.endsWith(".template.json"));

  const written = templates.map((template) => {
    const output = template.replace(".template.json", ".json");
    fs.writeFileSync(
      path.join(dir, output),
      applyOrigin(fs.readFileSync(path.join(dir, template), "utf8"), origin),
    );
    return output;
  });

  const generated = [
    "photos.json",
    ...themedStyles(gallery).map(([name]) => `${name}.json`),
    ...composedStyles(spriteUrl).map(([name]) => `${name}.json`),
  ];
  log(`Wrote ${[...generated, ...written].length} map styles for ${origin}`);
  return [...generated, ...written];
};

module.exports = { applyOrigin, composedStyles, themedStyles, run };

/* istanbul ignore next -- direct CLI dispatch; run is tested through applyOrigin */
if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
