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
  /**
   * Blurred copies of the roads beneath the roads: what makes a road look lit
   * rather than drawn. `{ colour, width, blur, opacity }`, or an array of them
   * for real bloom — one pass is a smudge, three are a halo that falls off the
   * way light does. Null for a flat map.
   */
  glow: null,
  /**
   * Buildings with height, as `{ colour, opacity, minzoom }`.
   *
   * A city is not flat, and a lit one least of all: the light comes off the
   * buildings, so a night basemap that draws them as footprints has nothing in
   * it above the road surface.
   */
  extrusion: null,
  /**
   * The small roads, so the grid has a hierarchy rather than one value
   * everywhere: a colour, or `{ colour, width }` to draw them thinner as well
   * as quieter. On a hand-drawn map especially, a lane at the same weight as a
   * high street is the clutter, not the colour.
   */
  minorRoad: null,
  /**
   * The lines nobody drives on, as `{ colour, metro, width, dash, glow }`.
   *
   * Worth its own option because in the cities these photographs are of, the
   * railway *is* the street plan a reader navigates by: a map of Tokyo or
   * Singapore with no Metro or MRT on it is missing how anybody got anywhere.
   * `metro` colours the subways, light rail, trams and monorails separately
   * from heavy rail, since they are different networks to a reader.
   */
  rail: null,
  /** A pattern laid over the whole map — grain, scanlines — as `{ id, opacity }`. */
  overlay: null,
  /**
   * A pattern printed into the land and water fills, as `{ land, water }`, and
   * optionally `minzoom` — a screen is ink on paper, and at world scale its
   * dots are the size of countries.
   */
  screen: null,
  /**
   * A stroke along the water's edge, as `{ colour, width, opacity, blur }`.
   *
   * What a dark basemap needs at world scale: two near-blacks a shade apart are
   * one black from four thousand kilometres up, and the map opens as an empty
   * screen with country names floating on it.
   */
  coast: null,
  /**
   * Pixels to offset a dark copy of each fill by, so the map reads as cut card
   * stacked on card rather than as ink on paper.
   */
  shadow: 0,
  /** "globe" puts the map on a sphere; the default leaves it flat. */
  projection: null,
  /**
   * Atmosphere: a sky layer, which on a globe is the halo around the planet and
   * on a tilted flat map is the horizon. `{ sky, horizon, atmosphere }`.
   */
  sky: null,
  /** Where the pattern images come from; required by `overlay` and `screen`. */
  spriteUrl: null,
  /**
   * How the names are set, as `{ font, transform, letterSpacing }`.
   *
   * The free glyph server has Noto Sans in two weights and nothing else — no
   * monospace, and self-hosting one would mean shipping CJK ranges to get a
   * terminal's typeface. Bold, spaced and upper-cased reads as a terminal
   * without any of that.
   */
  labelStyle: null,
};

const ROAD_CLASSES = {
  all: ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"],
  major: ["motorway", "trunk", "primary", "secondary"],
};

/** What the `minorRoad` layer draws, and therefore what the ink layer skips. */
const MINOR_ROAD_CLASSES = ["minor", "service", "track", "path"];

const scaled = (stops, scale) =>
  stops.map(([zoom, width]) => [zoom, Math.max(0.1, Number((width * scale).toFixed(2)))]);

const interpolate = (stops) => [
  "interpolate",
  ["linear"],
  ["zoom"],
  ...stops.flatMap(([zoom, value]) => [zoom, value]),
];

/**
 * The atmosphere, which is a document property rather than a layer: MapLibre
 * draws the halo around a globe and the horizon on a tilted map from this, and
 * a `sky` *layer* is not a thing the style spec has.
 */
const skyFor = (sky) => ({
  "sky-color": sky.sky ?? "#0a1622",
  "horizon-color": sky.horizon ?? "#3f6f9c",
  "fog-color": sky.fog ?? "#0a1622",
  "sky-horizon-blend": 0.6,
  "horizon-fog-blend": 0.5,
  "fog-ground-blend": 0.5,
  "atmosphere-blend": sky.atmosphere ?? 0.8,
});

/** A fill's own shadow: the same geometry, nudged, in the theme's ink. */
const shadowLayer = (id, sourceLayer, palette, options) => ({
  id: `${id}-shadow`,
  type: "fill",
  source: SOURCE,
  "source-layer": sourceLayer,
  paint: {
    "fill-color": palette.label,
    "fill-opacity": 0.28,
    "fill-translate": [options.shadow, options.shadow],
  },
});

/** Every layer this composer can draw, in the order a map wants them. */
const buildLayers = (palette, options) => {
  const layers = [
    { id: "ground", type: "background", paint: { "background-color": palette.land } },
  ];

  if (options.screen?.land) {
    layers.push({
      id: "land-screen",
      type: "background",
      ...(options.screen.minzoom === undefined ? {} : { minzoom: options.screen.minzoom }),
      paint: { "background-pattern": options.screen.land },
    });
  }

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

  if (options.shadow && !options.outlineOnly) {
    layers.push(shadowLayer("water", "water", palette, options));
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

  if (options.screen?.water && !options.outlineOnly) {
    layers.push({
      id: "water-screen",
      type: "fill",
      source: SOURCE,
      "source-layer": "water",
      ...(options.screen.minzoom === undefined ? {} : { minzoom: options.screen.minzoom }),
      paint: { "fill-pattern": options.screen.water },
    });
  }

  if (options.coast) {
    layers.push({
      id: "coast",
      type: "line",
      source: SOURCE,
      "source-layer": "water",
      paint: {
        "line-color": options.coast.colour ?? palette.water,
        "line-width": interpolate(
          scaled(
            [
              [0, 0.6],
              [6, 1],
              [12, 1.6],
            ],
            (options.coast.width ?? 1) * options.lineWidthScale,
          ),
        ),
        "line-opacity": options.coast.opacity ?? 0.9,
        // Paint pools where it meets a wet edge. A blurred coast is the one
        // thing that makes a wash read as paint rather than as a fill with a
        // stroke on it.
        ...(options.coast.blur === undefined ? {} : { "line-blur": options.coast.blur }),
      },
    });
  }

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

  if (options.buildings && options.shadow && !options.outlineOnly) {
    layers.push({
      ...shadowLayer("buildings", "building", palette, options),
      minzoom: 13,
    });
  }

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

  // A style that gives the small streets a weight of their own draws them
  // *only* there. Painting a quieter line over the full-weight one cannot make
  // them quieter — at 0.28 opacity the ink underneath still shows through — so
  // on sketch a district at z12 came out as one mesh whatever the minor colour
  // was. The casing below is deliberately left alone: it gives every street a
  // pale body, and it is what carries the grid on the styles where the small
  // streets are lighter than the ground they are on.
  const inkClasses = options.minorRoad
    ? classes.filter((name) => !MINOR_ROAD_CLASSES.includes(name))
    : classes;

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

  // Widest and faintest first, so the passes stack into a halo rather than
  // fighting each other.
  const glows = options.glow ? (Array.isArray(options.glow) ? options.glow : [options.glow]) : [];
  glows.forEach((glow, pass) => {
    // A pass may follow fewer roads than the map draws. At street zoom a wide
    // blur on every lane merges into one lit field — the city stops being a
    // grid and becomes a colour — so the broad wash follows the arterials and
    // only the tight passes follow everything.
    const glowClasses = ROAD_CLASSES[glow.roads] ?? classes;
    layers.push({
      id: pass === 0 ? "road-glow" : `road-glow-${pass}`,
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      filter: ["in", "class", ...glowClasses],
      paint: {
        "line-color": glow.colour ?? palette.road,
        "line-blur": glow.blur ?? 6,
        "line-opacity": glow.opacity ?? 0.55,
        "line-width": interpolate(
          scaled(
            [
              [6, 2],
              [12, 8],
              [16, 22],
            ],
            (glow.width ?? 1) * options.lineWidthScale,
          ),
        ),
      },
    });
  });

  layers.push({
    id: "roads",
    type: "line",
    source: SOURCE,
    "source-layer": "transportation",
    filter: ["in", "class", ...inkClasses],
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

  if (options.minorRoad) {
    const minor =
      typeof options.minorRoad === "string" ? { colour: options.minorRoad } : options.minorRoad;

    // The only ink these classes get; the roads layer above skips them.
    layers.push({
      id: "minor-roads",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      filter: ["in", "class", "minor", "service", "track", "path"],
      paint: {
        "line-color": minor.colour,
        "line-width": interpolate(
          scaled(
            [
              [6, 0.4],
              [12, 1.6],
              [16, 4.5],
            ],
            (minor.width ?? 1) * options.lineWidthScale,
          ),
        ),
        // Thinner is not enough on its own in a city that has an alley every
        // thirty metres: at a district zoom a thousand hairlines still read as
        // a mesh. A style can fade them in instead, so they arrive as the
        // reader gets close enough for one of them to mean anything.
        ...(minor.opacity === undefined
          ? {}
          : {
              "line-opacity":
                typeof minor.opacity === "number" ? minor.opacity : interpolate(minor.opacity),
            }),
      },
    });
  }

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

  if (options.rail) {
    const rail = typeof options.rail === "string" ? { colour: options.rail } : options.rail;
    const railWidth = (scale) =>
      interpolate(
        scaled(
          [
            [7, 0.5],
            [12, 1.3],
            [16, 2.8],
          ],
          scale * options.lineWidthScale,
        ),
      );

    // The metro has a ramp of its own because it has a different floor: the
    // tiles carry heavy rail from about z10 and subways only from z14 — checked
    // against the tiles themselves, where a Tokyo z13 tile has eleven railways
    // and no subway and its z14 child has eight. There is no point drawing it
    // hairline-thin at a zoom where none of it exists, so it arrives at a
    // weight a reader can follow a line at.
    const metroWidth = (scale) =>
      interpolate(
        scaled(
          [
            [13, 1],
            [16, 2.8],
            [18, 4.4],
          ],
          scale * options.lineWidthScale,
        ),
      );

    // Above the roads rather than under them: a metro line that disappears
    // wherever it runs beneath a main road is not a network a reader can
    // follow. Tunnels are drawn too, for the same reason — the Tokyo Metro is
    // almost entirely underground, and filtering brunnels erases it.
    if (rail.glow) {
      layers.push({
        id: "rail-glow",
        type: "line",
        source: SOURCE,
        "source-layer": "transportation",
        ...(rail.minzoom === undefined ? {} : { minzoom: rail.minzoom }),
        filter: ["in", "class", "rail", "transit"],
        paint: {
          "line-color": rail.glow.colour ?? rail.colour,
          "line-blur": rail.glow.blur ?? 4,
          "line-opacity": rail.glow.opacity ?? 0.5,
          "line-width": railWidth((rail.glow.width ?? 5) * (rail.width ?? 1)),
        },
      });
    }

    layers.push({
      id: "rail",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      ...(rail.minzoom === undefined ? {} : { minzoom: rail.minzoom }),
      filter: ["==", "class", "rail"],
      paint: {
        "line-color": rail.colour,
        "line-width": railWidth(rail.width ?? 1),
        ...(rail.dash ? { "line-dasharray": rail.dash } : {}),
      },
    });

    layers.push({
      id: "transit",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      ...(rail.minzoom === undefined ? {} : { minzoom: rail.minzoom }),
      // Everything that runs on rails but is not the mainline: subway, light
      // rail, tram, monorail, funicular.
      filter: ["==", "class", "transit"],
      paint: {
        "line-color": rail.metro ?? rail.colour,
        "line-width": metroWidth(rail.metroWidth ?? rail.width ?? 1),
        ...(rail.metroDash ? { "line-dasharray": rail.metroDash } : {}),
      },
    });
  }

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

  if (options.extrusion) {
    layers.push({
      id: "building-extrusion",
      type: "fill-extrusion",
      source: SOURCE,
      "source-layer": "building",
      minzoom: options.extrusion.minzoom ?? 14,
      paint: {
        "fill-extrusion-color": options.extrusion.colour ?? palette.building,
        "fill-extrusion-opacity": options.extrusion.opacity ?? 0.85,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 12],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        // Lit from the ground up, which is where a city's light comes from.
        "fill-extrusion-vertical-gradient": true,
      },
    });
  }

  if (options.labels) {
    // Wards, suburbs and villages, from the zoom where a reader has stopped
    // looking at the country and started looking at a place. Without these a
    // composed basemap has no names at all below city scale: the world map
    // reads fine and a street corner is anonymous.
    layers.push({
      id: "place-labels-small",
      type: "symbol",
      source: SOURCE,
      "source-layer": "place",
      minzoom: 10,
      filter: ["in", "class", "village", "hamlet", "suburb", "quarter", "neighbourhood"],
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": options.labelStyle?.font ?? LABEL_FONT,
        ...(options.labelStyle?.transform
          ? { "text-transform": options.labelStyle.transform }
          : {}),
        ...(options.labelStyle?.letterSpacing === undefined
          ? {}
          : { "text-letter-spacing": options.labelStyle.letterSpacing }),
        "text-size": interpolate([
          [10, 10],
          [14, 12],
          [16, 14],
        ]),
      },
      paint: {
        "text-color": palette.label,
        "text-halo-color": palette.labelHalo,
        "text-halo-width": 1.1,
        // Quieter than the cities they sit inside, so the hierarchy survives.
        "text-opacity": 0.78,
      },
    });

    layers.push({
      id: "place-labels",
      type: "symbol",
      source: SOURCE,
      "source-layer": "place",
      filter: ["in", "class", "city", "town", "country", "state"],
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": options.labelStyle?.font ?? LABEL_FONT,
        ...(options.labelStyle?.transform
          ? { "text-transform": options.labelStyle.transform }
          : {}),
        ...(options.labelStyle?.letterSpacing === undefined
          ? {}
          : { "text-letter-spacing": options.labelStyle.letterSpacing }),
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

  if (options.overlay) {
    layers.push({
      id: "overlay",
      type: "background",
      paint: {
        "background-pattern": options.overlay.id,
        "background-opacity": options.overlay.opacity ?? 1,
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
    ...(resolvedOptions.projection ? { projection: { type: resolvedOptions.projection } } : {}),
    ...(resolvedOptions.sky ? { sky: skyFor(resolvedOptions.sky) } : {}),
    sources: {
      [SOURCE]: { type: "vector", url: OPEN_FREE_MAP.tiles, attribution: ATTRIBUTION },
    },
    glyphs: OPEN_FREE_MAP.fonts,
    ...(resolvedOptions.spriteUrl ? { sprite: resolvedOptions.spriteUrl } : {}),
    layers: buildLayers(resolvedPalette, resolvedOptions),
  };
};

module.exports = { composeMapStyle, paletteDefaults, optionDefaults, ROAD_CLASSES, skyFor };
