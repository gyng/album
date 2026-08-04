const fs = require("node:fs");
const path = require("node:path");
const { validateStyleMin } = require("@maplibre/maplibre-gl-style-spec");
const { composedStyles, themedStyles } = require("./prepare-map-styles.cjs");

/**
 * Every basemap this site generates, checked against the style specification.
 *
 * This is not pedantry: MapLibre rejects an invalid document wholesale, so one
 * mistyped property is not a missing halo or a flat globe — it is a blank map
 * with the controls still on it. A `sky` *layer* (the spec has a root `sky`
 * property instead) took the globe down exactly that way.
 */
const documents = () => [
  ...composedStyles("https://example.test/map-styles/patterns/sprite"),
  ...themedStyles(
    JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "public", "map-styles", "gallery.template.json"),
        "utf8",
      ),
    ),
  ),
];

describe("the generated basemaps", () => {
  it.each(documents().map(([name, style]) => [name, style]))(
    "%s is a valid style",
    (_name, style) => {
      expect(validateStyleMin(style).map((error) => error.message)).toEqual([]);
    },
  );

  it("names a pattern only when it also names a sprite to find it in", () => {
    for (const [, style] of composedStyles("https://example.test/sprite")) {
      const patterns = JSON.stringify(style.layers).match(/"(background|fill)-pattern"/g) ?? [];
      if (patterns.length > 0) {
        expect(style.sprite).toBeTruthy();
      }
    }
  });
});
