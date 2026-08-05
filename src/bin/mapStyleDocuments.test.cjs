const fs = require("node:fs");
const path = require("node:path");
const { validateStyleMin } = require("@maplibre/maplibre-gl-style-spec");
const { composedStyles, themedStyles } = require("./prepare-map-styles.cjs");
const { parseColour } = require("./tintMapStyle.cjs");

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

/**
 * The metro line has to be visible on every theme, not on the three somebody
 * looked at.
 *
 * It is coloured from each theme's ink after that theme's tint, which contrasts
 * with the ground by construction — but "by construction" is exactly the claim
 * worth a test, since the alternative failure is silent: on ember the line was
 * once dark brown on dark brown and the network simply was not there.
 */
// `parseColour` hands back channels in 0..1, not 0..255.
const relativeLuminance = ({ r, g, b }) => {
  const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a, b) => {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/** The ground under the metro, at the zoom the metro exists at. */
const groundColour = (style) => {
  const background = style.layers.find((layer) => layer.type === "background");
  const colour = background.paint["background-color"];
  if (typeof colour === "string") return colour;
  // An interpolate over zoom: take the last stop, which is the close-in one.
  return colour.at(-1);
};

describe("the metro on a themed basemap", () => {
  const themed = themedStyles(
    JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "public", "map-styles", "gallery.template.json"),
        "utf8",
      ),
    ),
  );

  it.each(themed.map(([name, style]) => [name, style]))("%s draws it", (_name, style) => {
    const metro = style.layers.find((layer) => layer.id === "Metro");
    expect(metro).toBeDefined();

    const line = parseColour(metro.paint["line-color"]);
    const ground = parseColour(groundColour(style));
    expect(line).not.toBeNull();
    expect(ground).not.toBeNull();
    // Not a text contrast ratio — this is a hairline at 0.55 opacity, so the
    // bar is what separates "a line you can follow" from "the ground".
    expect(contrast(line, ground)).toBeGreaterThan(2);
  });
});
