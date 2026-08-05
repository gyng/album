const { applyOrigin, withTransit } = require("./prepare-map-styles.cjs");

describe("applyOrigin", () => {
  // MapLibre rejects a relative sprite URL outright, so the origin has to be
  // in the document — and it differs between a laptop, a preview and
  // production, which is why it cannot be committed.
  it("fills the origin into every place the template asks for one", () => {
    const filled = applyOrigin(
      '{"sprite":"{{origin}}/map-styles/gallery/sprite","x":"{{origin}}/y"}',
      "https://example.test",
    );

    expect(filled).toBe(
      '{"sprite":"https://example.test/map-styles/gallery/sprite","x":"https://example.test/y"}',
    );
    expect(filled).not.toContain("{{origin}}");
  });

  it("leaves a document with no token alone", () => {
    expect(applyOrigin('{"sprite":"https://cdn.test/sprite"}', "https://example.test")).toBe(
      '{"sprite":"https://cdn.test/sprite"}',
    );
  });
});

// The copied cartography draws heavy rail, light rail and trams — and no
// subways at all: its "Minor rail" layer filters on `subclass`, so
// `class=transit, subclass=subway` is in the tiles and on no layer. That is
// most of the network in Tokyo and all of it in Singapore.
describe("withTransit", () => {
  const style = {
    layers: [
      { id: "ground", type: "background" },
      { id: "roads", type: "line" },
      { id: "labels", type: "symbol" },
    ],
  };

  it("adds the metro under the names, so the names still read over it", () => {
    const layers = withTransit(style, { colour: "#123456" }).layers.map((layer) => layer.id);

    expect(layers).toEqual(["ground", "roads", "Metro", "labels"]);
  });

  it("draws only what runs on rails and is not the mainline", () => {
    const metro = withTransit(style, { colour: "#123456" }).layers.find(
      (layer) => layer.id === "Metro",
    );

    expect(metro.filter).toEqual(["==", "class", "transit"]);
    expect(metro.paint["line-color"]).toBe("#123456");
    expect(metro.paint["line-opacity"]).toBe(0.9);
  });

  it("puts it at the end of a style that writes nothing on itself", () => {
    const bare = { layers: [{ id: "ground", type: "background" }] };

    expect(withTransit(bare, { colour: "#123" }).layers.at(-1).id).toBe("Metro");
  });

  // Each style off the gallery template adds its own after its own tint, so
  // running twice must not stack two of them.
  it("leaves a style that already has one alone", () => {
    const once = withTransit(style, { colour: "#123456" });

    expect(withTransit(once, { colour: "#654321" })).toBe(once);
  });
});
