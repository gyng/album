// Basemap styles composed from a palette, rather than copied from a provider.
//
// Every style here draws the same OpenMapTiles layers OpenFreeMap serves; what
// changes is the palette and how much is drawn. That makes a basemap a table
// entry rather than a 20,000-line document, which is what lets the map follow
// the site's theme without committing one style per theme.

const OPEN_FREE_MAP = {
  tiles: "https://tiles.openfreemap.org/planet",
  fonts: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
};

const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

/** The one font the free glyph server has in three weights. */
const LABEL_FONT = ["Noto Sans Regular"];

const SOURCE = "openmaptiles";

/**
 * A palette is the whole design.
 *
 * Named for what they are on a map rather than for a colour, so a theme can be
 * transposed onto one without deciding what "secondary" means.
 */
const paletteDefaults = {
  land: "#f6f4ef",
  water: "#c9dcea",
  green: "#e2ebdc",
  built: "#ecebe6",
  road: "#ffffff",
  roadCasing: "#e0ded7",
  motorway: "#f2d6a8",
  building: "#e6e3db",
  boundary: "#c9c5bb",
  label: "#3f3d38",
  labelHalo: "#ffffffcc",
};

/**
 * How much of the map is drawn.
 *
 * `roads: "major"` keeps motorway through secondary and drops the rest, which
 * is what makes a basemap that a thousand photo pins can sit on top of.
 */
const optionDefaults = {
  labels: true,
  buildings: true,
  landcover: true,
  roads: "all",
  /** Draws linework only: no fills except the ground itself. */
  outlineOnly: false,
  lineWidthScale: 1,
};

const ROAD_CLASSES = {
  all: ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"],
  major: ["motorway", "trunk", "primary", "secondary"],
};

const scaled = (stops, scale) =>
  stops.map(([zoom, width]) => [zoom, Math.max(0.1, Number((width * scale).toFixed(2)))]);

const interpolate = (stops) => [
  "interpolate",
  ["linear"],
  ["zoom"],
  ...stops.flatMap(([zoom, value]) => [zoom, value]),
];

/** Every layer this composer can draw, in the order a map wants them. */
const buildLayers = (palette, options) => {
  const layers = [
    { id: "ground", type: "background", paint: { "background-color": palette.land } },
  ];

  if (options.landcover && !options.outlineOnly) {
    layers.push(
      {
        id: "green",
        type: "fill",
        source: SOURCE,
        "source-layer": "landcover",
        filter: ["in", "class", "wood", "grass", "park"],
        paint: { "fill-color": palette.green, "fill-opacity": 0.8 },
      },
      {
        id: "built-up",
        type: "fill",
        source: SOURCE,
        "source-layer": "landuse",
        filter: ["in", "class", "residential", "commercial", "industrial"],
        paint: { "fill-color": palette.built, "fill-opacity": 0.7 },
      },
    );
  }

  layers.push({
    id: "water",
    type: options.outlineOnly ? "line" : "fill",
    source: SOURCE,
    "source-layer": "water",
    paint: options.outlineOnly
      ? { "line-color": palette.water, "line-width": 1.2 * options.lineWidthScale }
      : { "fill-color": palette.water },
  });

  layers.push({
    id: "waterway",
    type: "line",
    source: SOURCE,
    "source-layer": "waterway",
    paint: {
      "line-color": palette.water,
      "line-width": interpolate(
        scaled(
          [
            [8, 0.6],
            [14, 1.8],
          ],
          options.lineWidthScale,
        ),
      ),
    },
  });

  if (options.buildings && !options.outlineOnly) {
    layers.push({
      id: "buildings",
      type: "fill",
      source: SOURCE,
      "source-layer": "building",
      minzoom: 13,
      paint: { "fill-color": palette.building, "fill-opacity": 0.9 },
    });
  }

  if (options.buildings && options.outlineOnly) {
    layers.push({
      id: "buildings",
      type: "line",
      source: SOURCE,
      "source-layer": "building",
      minzoom: 14,
      paint: { "line-color": palette.building, "line-width": 0.6 * options.lineWidthScale },
    });
  }

  const classes = ROAD_CLASSES[options.roads] ?? ROAD_CLASSES.all;

  if (!options.outlineOnly) {
    layers.push({
      id: "road-casing",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      filter: ["in", "class", ...classes],
      paint: {
        "line-color": palette.roadCasing,
        "line-width": interpolate(
          scaled(
            [
              [6, 0.8],
              [12, 3.4],
              [16, 9],
            ],
            options.lineWidthScale,
          ),
        ),
      },
    });
  }

  layers.push({
    id: "roads",
    type: "line",
    source: SOURCE,
    "source-layer": "transportation",
    filter: ["in", "class", ...classes],
    paint: {
      "line-color": palette.road,
      "line-width": interpolate(
        scaled(
          [
            [6, 0.4],
            [12, 2],
            [16, 6],
          ],
          options.lineWidthScale,
        ),
      ),
    },
  });

  layers.push({
    id: "motorways",
    type: "line",
    source: SOURCE,
    "source-layer": "transportation",
    filter: ["==", "class", "motorway"],
    paint: {
      "line-color": palette.motorway,
      "line-width": interpolate(
        scaled(
          [
            [6, 0.8],
            [12, 3],
            [16, 8],
          ],
          options.lineWidthScale,
        ),
      ),
    },
  });

  layers.push({
    id: "boundaries",
    type: "line",
    source: SOURCE,
    "source-layer": "boundary",
    filter: ["<=", "admin_level", 4],
    paint: {
      "line-color": palette.boundary,
      "line-dasharray": [2, 2],
      "line-width": 0.8 * options.lineWidthScale,
    },
  });

  if (options.labels) {
    layers.push({
      id: "place-labels",
      type: "symbol",
      source: SOURCE,
      "source-layer": "place",
      filter: ["in", "class", "city", "town", "country", "state"],
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": LABEL_FONT,
        "text-size": interpolate([
          [3, 10],
          [8, 13],
          [14, 17],
        ]),
      },
      paint: {
        "text-color": palette.label,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.2,
      },
    });
  }

  return layers;
};

/**
 * One basemap: a palette, a few decisions about how much to draw, and the free
 * tiles underneath.
 */
const composeMapStyle = ({ name, palette = {}, options = {} } = {}) => {
  const resolvedPalette = { ...paletteDefaults, ...palette };
  const resolvedOptions = { ...optionDefaults, ...options };

  return {
    version: 8,
    name: name ?? "Composed",
    sources: {
      [SOURCE]: { type: "vector", url: OPEN_FREE_MAP.tiles, attribution: ATTRIBUTION },
    },
    glyphs: OPEN_FREE_MAP.fonts,
    layers: buildLayers(resolvedPalette, resolvedOptions),
  };
};

module.exports = { composeMapStyle, paletteDefaults, optionDefaults, ROAD_CLASSES };
