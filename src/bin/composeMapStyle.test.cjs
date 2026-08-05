const { composeMapStyle, ROAD_CLASSES } = require("./composeMapStyle.cjs");

const layerIds = (style) => style.layers.map((layer) => layer.id);

describe("composeMapStyle", () => {
  it("draws from the free tiles and credits them", () => {
    const style = composeMapStyle({ name: "Test" });

    expect(style.sources.openmaptiles.url).toBe("https://tiles.openfreemap.org/planet");
    expect(style.sources.openmaptiles.attribution).toContain("OpenStreetMap");
    expect(JSON.stringify(style)).not.toContain("maptiler");
  });

  // The free glyph server answers for one font at a time, and a stack it cannot
  // fetch is a label that never draws.
  it("names a single font the free provider actually serves", () => {
    const labels = composeMapStyle({}).layers.find((layer) => layer.type === "symbol");

    expect(labels.layout["text-font"]).toEqual(["Noto Sans Regular"]);
  });

  // The free glyph server has Noto Sans and nothing else, so a terminal's
  // typeface has to be made out of weight, spacing and case.
  it("sets the names the way a style asks, in both label layers", () => {
    const style = composeMapStyle({
      options: {
        labelStyle: { font: ["Noto Sans Bold"], transform: "uppercase", letterSpacing: 0.12 },
      },
    });

    for (const id of ["place-labels", "place-labels-small"]) {
      const layer = style.layers.find((entry) => entry.id === id);
      expect(layer.layout["text-font"]).toEqual(["Noto Sans Bold"]);
      expect(layer.layout["text-transform"]).toBe("uppercase");
      expect(layer.layout["text-letter-spacing"]).toBe(0.12);
    }
  });

  it("leaves the names alone when a style says nothing about them", () => {
    const labels = composeMapStyle({}).layers.find((layer) => layer.id === "place-labels");

    expect(labels.layout["text-transform"]).toBeUndefined();
    expect(labels.layout["text-letter-spacing"]).toBeUndefined();
  });

  it("paints the ground from the palette it was given", () => {
    const style = composeMapStyle({ palette: { land: "#101010", water: "#202020" } });

    expect(style.layers[0].paint["background-color"]).toBe("#101010");
    expect(style.layers.find((layer) => layer.id === "water").paint["fill-color"]).toBe("#202020");
  });
});

describe("what a basemap leaves out", () => {
  // The world map draws 1,490 pins; the basemap under them is competing with
  // its own subject.
  it("can drop the labels, the buildings and the minor roads", () => {
    const style = composeMapStyle({
      options: { labels: false, buildings: false, landcover: false, roads: "major" },
    });

    expect(layerIds(style)).not.toContain("place-labels");
    expect(layerIds(style)).not.toContain("buildings");
    expect(layerIds(style)).not.toContain("green");
    expect(style.layers.find((layer) => layer.id === "roads").filter).toEqual([
      "in",
      "class",
      ...ROAD_CLASSES.major,
    ]);
  });

  // Below city scale the only names OpenMapTiles has are wards, suburbs and
  // villages; without them a composed basemap is anonymous exactly where a
  // reader has zoomed in to find out where they are.
  it("names the smaller places too, from the zoom they matter at", () => {
    const small = composeMapStyle({}).layers.find((layer) => layer.id === "place-labels-small");

    expect(small.filter).toEqual([
      "in",
      "class",
      "village",
      "hamlet",
      "suburb",
      "quarter",
      "neighbourhood",
    ]);
    expect(small.minzoom).toBeGreaterThanOrEqual(9);
    expect(small.paint["text-opacity"]).toBeLessThan(1);
  });

  it("drops the small names with the rest when a basemap wants none", () => {
    expect(layerIds(composeMapStyle({ options: { labels: false } }))).not.toContain(
      "place-labels-small",
    );
  });

  it("keeps everything by default", () => {
    const ids = layerIds(composeMapStyle({}));

    expect(ids).toEqual(expect.arrayContaining(["green", "buildings", "place-labels", "roads"]));
  });
});

describe("styles that are about more than colour", () => {
  // A road looks lit rather than drawn when a wide blurred copy sits under it,
  // which is a paint property rather than a post-processing pass.
  it("lays a blurred copy of the roads under the roads for a neon map", () => {
    const style = composeMapStyle({ options: { glow: { colour: "#00e5ff", blur: 8 } } });
    const ids = layerIds(style);
    const glow = style.layers.find((layer) => layer.id === "road-glow");

    expect(glow.paint["line-color"]).toBe("#00e5ff");
    expect(glow.paint["line-blur"]).toBe(8);
    expect(ids.indexOf("road-glow")).toBeLessThan(ids.indexOf("roads"));
  });

  // One blurred pass is a smudge. Three, widest and faintest first, fall off
  // the way light does.
  it("stacks glow passes into a halo, widest first", () => {
    const style = composeMapStyle({
      options: {
        glow: [
          { colour: "#003", blur: 24, width: 4, opacity: 0.25 },
          { colour: "#0af", blur: 8, width: 1.6, opacity: 0.5 },
        ],
      },
    });
    const ids = layerIds(style);

    expect(ids.filter((id) => id.startsWith("road-glow"))).toHaveLength(2);
    expect(ids.indexOf("road-glow")).toBeLessThan(ids.indexOf("road-glow-1"));
    expect(ids.indexOf("road-glow-1")).toBeLessThan(ids.indexOf("roads"));
  });

  // A lit city's light comes off its buildings, so a night basemap that draws
  // them as footprints has nothing in it above the road surface.
  it("stands the buildings up when asked", () => {
    const extruded = composeMapStyle({
      options: { extrusion: { colour: "#123", minzoom: 15 } },
    }).layers.find((layer) => layer.id === "building-extrusion");

    expect(extruded).toMatchObject({ type: "fill-extrusion", minzoom: 15 });
    expect(extruded.paint["fill-extrusion-color"]).toBe("#123");
    expect(extruded.paint["fill-extrusion-height"]).toEqual([
      "coalesce",
      ["get", "render_height"],
      12,
    ]);
    expect(layerIds(composeMapStyle({}))).not.toContain("building-extrusion");
  });

  it("gives the small streets a value of their own where a style asks", () => {
    const minor = composeMapStyle({ options: { minorRoad: "#334" } }).layers.find(
      (layer) => layer.id === "minor-roads",
    );

    expect(minor.paint["line-color"]).toBe("#334");
    expect(minor.filter).toEqual(["in", "class", "minor", "service", "track", "path"]);
    expect(layerIds(composeMapStyle({}))).not.toContain("minor-roads");
  });

  // In the cities these photographs are of, the railway is the plan a reader
  // navigates by — and the subways are a separate network from the mainline, so
  // they are allowed a separate colour.
  it("draws the railway and the metro as two networks", () => {
    const layers = composeMapStyle({
      options: { rail: { colour: "#333", metro: "#c0f", dash: [3, 2] } },
    }).layers;
    const rail = layers.find((layer) => layer.id === "rail");
    const transit = layers.find((layer) => layer.id === "transit");

    expect(rail.filter).toEqual(["==", "class", "rail"]);
    expect(rail.paint["line-color"]).toBe("#333");
    expect(rail.paint["line-dasharray"]).toEqual([3, 2]);
    expect(transit.filter).toEqual(["==", "class", "transit"]);
    expect(transit.paint["line-color"]).toBe("#c0f");
    expect(layerIds(composeMapStyle({}))).not.toContain("rail");
  });

  // Checked against the tiles: a Tokyo z13 tile carries eleven railways and no
  // subway, its z14 child eight. Drawing the metro on the railway's ramp made
  // it a hairline at zooms where none of it existed and never grew.
  it("starts the metro at the zoom its geometry exists at", () => {
    const layers = composeMapStyle({ options: { rail: "#333" } }).layers;
    const railStops = layers.find((layer) => layer.id === "rail").paint["line-width"];
    const metroStops = layers.find((layer) => layer.id === "transit").paint["line-width"];

    // The zoom each ramp begins at, which is the input of its first stop.
    expect(railStops[3]).toBe(7);
    expect(metroStops[3]).toBe(13);
    expect(metroStops.at(-1)).toBeGreaterThan(railStops.at(-1));
  });

  it("takes a minzoom and a glow for the whole network", () => {
    const layers = composeMapStyle({
      options: { rail: { colour: "#333", minzoom: 11, glow: { colour: "#0f0" } } },
    }).layers;

    expect(layers.find((layer) => layer.id === "rail").minzoom).toBe(11);
    expect(layers.find((layer) => layer.id === "transit").minzoom).toBe(11);
    expect(layers.find((layer) => layer.id === "rail-glow").paint["line-color"]).toBe("#0f0");
  });

  // A hairline is still clutter when there are a thousand of them in frame, so
  // a style can hold the small streets back until the reader is close enough
  // for one of them to be worth naming.
  it("fades the small streets in with the zoom where a style asks", () => {
    const paintOf = (options) =>
      composeMapStyle({ options: { minorRoad: options } }).layers.find(
        (layer) => layer.id === "minor-roads",
      ).paint;

    expect(paintOf("#334")["line-opacity"]).toBeUndefined();
    expect(paintOf({ colour: "#334", opacity: 0.4 })["line-opacity"]).toBe(0.4);
    expect(
      paintOf({
        colour: "#334",
        opacity: [
          [11, 0.2],
          [16, 0.9],
        ],
      })["line-opacity"],
    ).toEqual(["interpolate", ["linear"], ["zoom"], 11, 0.2, 16, 0.9]);
  });

  // On a hand-drawn map a lane at the same weight as a high street is the
  // clutter, whatever colour it is.
  it("draws the small streets thinner when asked, not only quieter", () => {
    const widthOf = (options) =>
      composeMapStyle({ options: { minorRoad: options } }).layers.find(
        (layer) => layer.id === "minor-roads",
      ).paint["line-width"];

    const full = widthOf("#334");
    const thin = widthOf({ colour: "#334", width: 0.5 });

    // Same stop zooms, half the weight at each of them.
    expect(thin.at(-1)).toBeCloseTo(full.at(-1) / 2, 5);
    expect(thin.at(-3)).toBeCloseTo(full.at(-3) / 2, 5);
  });

  // A wide blur on every lane merges into one lit field at street zoom, so a
  // pass can follow fewer roads than the map draws.
  it("lets a glow pass follow only the arterials", () => {
    const style = composeMapStyle({
      options: { roads: "all", glow: [{ blur: 20, roads: "major" }, { blur: 4 }] },
    });

    expect(style.layers.find((layer) => layer.id === "road-glow").filter).toEqual([
      "in",
      "class",
      ...ROAD_CLASSES.major,
    ]);
    expect(style.layers.find((layer) => layer.id === "road-glow-1").filter).toEqual([
      "in",
      "class",
      ...ROAD_CLASSES.all,
    ]);
  });

  it("draws no glow at all by default", () => {
    expect(layerIds(composeMapStyle({}))).not.toContain("road-glow");
  });

  // A glow with nothing specified still has to be a glow: the road's own colour,
  // wide and soft.
  it("gives a glow sensible proportions when it is only asked for", () => {
    const glow = composeMapStyle({
      palette: { road: "#ff00aa" },
      options: { glow: {} },
    }).layers.find((layer) => layer.id === "road-glow");

    expect(glow.paint["line-color"]).toBe("#ff00aa");
    expect(glow.paint["line-blur"]).toBeGreaterThan(0);
    expect(glow.paint["line-opacity"]).toBeGreaterThan(0);
    expect(glow.paint["line-width"]).toBeDefined();
  });

  // Patterns come out of a sprite, and a style naming one without a sprite URL
  // draws nothing at all.
  it("prints a screen into the ground and the water, and an overlay over both", () => {
    const style = composeMapStyle({
      options: {
        spriteUrl: "https://example.test/patterns/sprite",
        screen: { land: "dot-coarse", water: "dot-fine" },
        overlay: { id: "grain", opacity: 0.3 },
      },
    });

    expect(style.sprite).toBe("https://example.test/patterns/sprite");
    expect(
      style.layers.find((layer) => layer.id === "land-screen").paint["background-pattern"],
    ).toBe("dot-coarse");
    expect(style.layers.find((layer) => layer.id === "water-screen").paint["fill-pattern"]).toBe(
      "dot-fine",
    );
    // The overlay is the last thing drawn, or it is not over anything.
    expect(layerIds(style).at(-1)).toBe("overlay");
    expect(style.layers.at(-1).paint["background-opacity"]).toBe(0.3);
  });

  it("leaves an overlay at full strength when no opacity is given", () => {
    const style = composeMapStyle({ options: { overlay: { id: "scanline" } } });

    expect(style.layers.at(-1).paint["background-opacity"]).toBe(1);
  });

  // Two near-blacks a shade apart are one black from four thousand kilometres
  // up, so a night map opens as an empty screen unless its water has an edge.
  it("draws an edge along the water when asked", () => {
    const style = composeMapStyle({ options: { coast: { colour: "#00b7ff" } } });
    const coast = style.layers.find((layer) => layer.id === "coast");
    const ids = layerIds(style);

    expect(coast).toMatchObject({ type: "line", "source-layer": "water" });
    expect(coast.paint["line-color"]).toBe("#00b7ff");
    expect(ids.indexOf("coast")).toBeGreaterThan(ids.indexOf("water"));
    expect(layerIds(composeMapStyle({}))).not.toContain("coast");
  });

  // A dot screen is ink on paper; at world scale its dots are the size of
  // countries, which is a pattern rather than a texture.
  it("holds a screen back until the zoom it reads as texture at", () => {
    const style = composeMapStyle({
      options: {
        spriteUrl: "https://example.test/sprite",
        screen: { land: "dot-fine", water: "dot-fine", minzoom: 6 },
      },
    });

    expect(style.layers.find((layer) => layer.id === "land-screen").minzoom).toBe(6);
    expect(style.layers.find((layer) => layer.id === "water-screen").minzoom).toBe(6);
  });

  it("stacks a shadow under each fill when the map is cut card", () => {
    const style = composeMapStyle({ options: { shadow: 3 } });
    const ids = layerIds(style);
    const shadow = style.layers.find((layer) => layer.id === "water-shadow");

    expect(shadow.paint["fill-translate"]).toEqual([3, 3]);
    expect(ids.indexOf("water-shadow")).toBeLessThan(ids.indexOf("water"));
    expect(ids.indexOf("buildings-shadow")).toBeLessThan(ids.indexOf("buildings"));
  });

  // On a globe the sky layer is the halo around the planet, so a globe without
  // one is a flat disc cut out of the background.
  // The atmosphere is a document property, not a layer — a "sky" layer is not
  // a thing the style spec has, and one invalidates the whole style, which
  // takes the map down rather than the halo.
  it("gives the planet an atmosphere when asked for one", () => {
    const style = composeMapStyle({ options: { sky: { horizon: "#4488cc" } } });

    expect(style.sky["horizon-color"]).toBe("#4488cc");
    expect(style.sky["atmosphere-blend"]).toBeGreaterThan(0);
    expect(style.layers.some((layer) => layer.type === "sky")).toBe(false);
    expect(composeMapStyle({}).sky).toBeUndefined();
  });

  it("puts the map on a sphere when asked, and leaves it flat otherwise", () => {
    expect(composeMapStyle({ options: { projection: "globe" } }).projection).toEqual({
      type: "globe",
    });
    expect(composeMapStyle({}).projection).toBeUndefined();
    expect(composeMapStyle({}).sprite).toBeUndefined();
  });

  // Linework has no fills to cast shadows or hold a screen.
  it("keeps a sketch free of shadows and screens", () => {
    const ids = layerIds(
      composeMapStyle({
        options: { outlineOnly: true, shadow: 3, screen: { water: "dot-fine" } },
      }),
    );

    expect(ids).not.toContain("water-shadow");
    expect(ids).not.toContain("water-screen");
  });
});

describe("a drawing rather than a map", () => {
  // Sketch is watercolour's sibling: linework, no fills, so the ground shows
  // through everything.
  it("outlines the water and the buildings instead of filling them", () => {
    const style = composeMapStyle({ options: { outlineOnly: true } });

    expect(style.layers.find((layer) => layer.id === "water").type).toBe("line");
    expect(style.layers.find((layer) => layer.id === "buildings").type).toBe("line");
    expect(layerIds(style)).not.toContain("road-casing");
    expect(layerIds(style)).not.toContain("green");
  });

  it("scales its line weights, so a sketch can be drawn with a thicker pen", () => {
    const thin = composeMapStyle({ options: { lineWidthScale: 1 } });
    const thick = composeMapStyle({ options: { lineWidthScale: 2 } });

    const widthOf = (style) =>
      style.layers.find((layer) => layer.id === "boundaries").paint["line-width"];
    expect(widthOf(thick)).toBeCloseTo(widthOf(thin) * 2, 5);
  });
});
