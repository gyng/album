const { buildFreeStyle, remapFonts, rewriteLayer } = require("./build-free-gallery-style.cjs");

const mapTilerStyle = {
  version: 8,
  name: "StreetsNative",
  sources: {
    maptiler_planet: { type: "vector", url: "https://api.maptiler.com/tiles/v3/tiles.json?key=k" },
    maptiler_attribution: { type: "vector", attribution: "© MapTiler" },
  },
  glyphs: "https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=k",
  sprite: "https://api.maptiler.com/maps/abc/sprite",
  layers: [
    { id: "background", type: "background" },
    {
      id: "roads",
      type: "line",
      source: "maptiler_planet",
      "source-layer": "transportation",
      layout: { "text-font": ["Roboto Medium", "Noto Sans Regular"] },
    },
    {
      id: "landcover-wash",
      type: "fill",
      source: "maptiler_planet",
      "source-layer": "globallandcover",
    },
  ],
};

describe("remapFonts", () => {
  // The free glyph server answers for one font and 404s the comma-joined path
  // MapLibre builds for a stack — even a stack of the same font twice — and a
  // font it cannot fetch is a label that never draws.
  it("reduces a stack to the single font the provider can serve", () => {
    expect(remapFonts(["Noto Sans Regular", "Noto Sans Regular"])).toEqual(["Noto Sans Regular"]);
    expect(remapFonts(["Noto Sans Bold", "Noto Sans Regular"])).toEqual(["Noto Sans Bold"]);
  });

  it("maps a font it does not serve onto the nearest weight it does", () => {
    expect(remapFonts(["Roboto Medium"])).toEqual(["Noto Sans Bold"]);
    expect(remapFonts(["Roboto Italic"])).toEqual(["Noto Sans Italic"]);
    expect(remapFonts(["Metropolis Regular"])).toEqual(["Noto Sans Regular"]);
  });

  // A style can set its font with an expression, and the fonts inside it are
  // just as unfetchable.
  it("reaches the fonts inside a data-driven expression", () => {
    const expression = [
      "match",
      ["get", "class"],
      "motorway",
      ["literal", ["Roboto Bold", "Noto Sans Bold"]],
      ["literal", ["Roboto Regular"]],
    ];

    expect(remapFonts(expression)).toEqual([
      "match",
      ["get", "class"],
      "motorway",
      ["literal", ["Noto Sans Bold"]],
      ["literal", ["Noto Sans Regular"]],
    ]);
  });
});

describe("rewriteLayer", () => {
  it("points a layer at the free source and fixes its fonts", () => {
    const layer = rewriteLayer(mapTilerStyle.layers[1], "openmaptiles");

    expect(layer.source).toBe("openmaptiles");
    expect(layer.layout["text-font"]).toEqual(["Noto Sans Bold"]);
  });

  // The free tiles carry `landcover` and `landuse` but not MapTiler's own
  // low-zoom wash, so that layer would draw nothing at all.
  it("drops a layer whose source layer the free tiles do not carry", () => {
    expect(rewriteLayer(mapTilerStyle.layers[2], "openmaptiles")).toBeNull();
  });

  it("leaves a source-less layer as it is", () => {
    expect(rewriteLayer(mapTilerStyle.layers[0], "openmaptiles")).toEqual({
      id: "background",
      type: "background",
    });
  });
});

describe("buildFreeStyle", () => {
  const free = buildFreeStyle(mapTilerStyle);

  it("serves its tiles, fonts and sprite from somewhere unmetered", () => {
    expect(JSON.stringify(free)).not.toContain("api.maptiler.com");
    expect(free.sources.openmaptiles.url).toBe("https://tiles.openfreemap.org/planet");
    expect(free.glyphs).toContain("tiles.openfreemap.org");
    // MapLibre rejects a relative sprite URL, and the origin differs between a
    // laptop, a preview and production, so the build fills this in.
    expect(free.sprite).toBe("{{origin}}/map-styles/gallery/sprite");
  });

  it("credits the data it is actually serving", () => {
    expect(free.sources.openmaptiles.attribution).toContain("OpenFreeMap");
    expect(free.sources.openmaptiles.attribution).toContain("OpenStreetMap");
    expect(JSON.stringify(free)).not.toContain("MapTiler");
  });

  // The second source carried nothing but the old provider's attribution.
  it("keeps one source rather than the provider's pair", () => {
    expect(Object.keys(free.sources)).toEqual(["openmaptiles"]);
  });

  it("keeps the design: every layer that can still draw", () => {
    expect(free.layers.map((layer) => layer.id)).toEqual(["background", "roads"]);
  });
});

describe("a style whose landmass comes from elsewhere", () => {
  // The watercolour style fills its land from a separate MapTiler tileset the
  // free provider does not have. OpenFreeMap's own styles get the same result
  // from a background colour with the water drawn over it.
  it("turns a land fill into a background of the same colour", () => {
    const layer = rewriteLayer(
      {
        id: "Land",
        type: "fill",
        source: "land",
        "source-layer": "land",
        paint: { "fill-color": "hsl(46, 65%, 91%)" },
      },
      "openmaptiles",
    );

    expect(layer).toEqual({
      id: "Land",
      type: "background",
      paint: { "background-color": "hsl(46, 65%, 91%)" },
    });
  });

  it("drops the terrain layers no free tiles carry", () => {
    for (const sourceLayer of ["contour", "trail", "outdoor_poi"]) {
      expect(rewriteLayer({ id: sourceLayer, "source-layer": sourceLayer }, "x")).toBeNull();
    }
  });
});
