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

  it("keeps everything by default", () => {
    const ids = layerIds(composeMapStyle({}));

    expect(ids).toEqual(expect.arrayContaining(["green", "buildings", "place-labels", "roads"]));
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
