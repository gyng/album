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
 * Not about colour — the themes cover that — but about how much is drawn: a
 * basemap with nothing on it but ground, water and the roads that matter, for
 * the map carrying fourteen hundred pins; and linework on paper, watercolour's
 * sibling.
 *
 * @returns {Array<[string, object]>} each style's file name and document.
 */
const composedStyles = () => {
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

  return styles;
};

/** Replaces every origin token; returns the document untouched when there is none. */
const applyOrigin = (template, origin) => template.split(ORIGIN_TOKEN).join(origin);

/* istanbul ignore next -- disk; applyOrigin is what is tested */
const run = (log = console.log, env = process.env) => {
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

  // Composed styles have no template to fill in: they are built from a palette
  // here, so a basemap is a table entry rather than a committed document.
  for (const [name, style] of composedStyles()) {
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
    ...themedStyles(gallery).map(([name]) => `${name}.json`),
    ...composedStyles().map(([name]) => `${name}.json`),
  ];
  log(`Wrote ${[...generated, ...written].length} map styles for ${origin}`);
  return [...generated, ...written];
};

module.exports = { applyOrigin, run };

/* istanbul ignore next -- direct CLI dispatch; run is tested through applyOrigin */
if (require.main === module) {
  run();
}
