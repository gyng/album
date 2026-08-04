const { parseColour, toHsl, toCssColour, tintColour, tintMapStyle } = require("./tintMapStyle.cjs");

const PALETTE = {
  land: "#101d28",
  water: "#123044",
  label: "#bcd2e0",
};

describe("reading a colour out of a style", () => {
  it("reads the notations a style sheet actually uses", () => {
    expect(parseColour("#fff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseColour("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColour("rgb(255, 0, 0)")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColour(" hsl(0, 0%, 100%) ")).toMatchObject({ r: 1, g: 1, b: 1 });
  });

  it("keeps the transparency a halo or a casing depends on", () => {
    expect(parseColour("#00000080").a).toBeCloseTo(0.502, 2);
    expect(parseColour("rgba(0, 0, 0, 0.4)").a).toBe(0.4);
  });

  it("leaves anything it does not understand alone", () => {
    expect(parseColour("transparent")).toBeNull();
    expect(parseColour(["interpolate"])).toBeNull();
  });

  it("round-trips through hex", () => {
    expect(toCssColour(parseColour("#3f7ac2"))).toBe("#3f7ac2");
  });

  it("treats a colour with no alpha as opaque", () => {
    expect(toCssColour({ r: 1, g: 0, b: 0 })).toBe("#ff0000");
  });

  // An eight-digit hex is not universally parsed, and a halo colour a parser
  // rejects is a label drawn with no halo at all.
  it("writes transparency as rgba() rather than eight-digit hex", () => {
    expect(toCssColour(parseColour("rgba(0, 0, 0, 0.4)"))).toBe("rgba(0, 0, 0, 0.4)");
  });

  it("finds the hue and lightness a tint is decided by", () => {
    const blue = toHsl(parseColour("#3f7ac2"));

    expect(blue.h).toBeGreaterThan(200);
    expect(blue.h).toBeLessThan(225);
    expect(blue.l).toBeCloseTo(0.5, 1);
    expect(toHsl(parseColour("#808080")).s).toBe(0);
  });

  // Water detection is a hue window, so a hue read from the wrong channel would
  // tint half the map as sea.
  it("reads the hue whichever channel is strongest", () => {
    expect(toHsl(parseColour("#ff0000")).h).toBeCloseTo(0, 5);
    expect(toHsl(parseColour("#00ff00")).h).toBeCloseTo(120, 5);
    expect(toHsl(parseColour("#0000ff")).h).toBeCloseTo(240, 5);
    expect(toHsl(parseColour("#ff00ff")).h).toBeCloseTo(300, 5);
  });

  // The gallery style is written in hsl() throughout, and the ones with a hue
  // past 180° are its water.
  it("round-trips every sector of the hsl wheel", () => {
    for (const [hue, expected] of [
      [0, "#ff0000"],
      [60, "#ffff00"],
      [120, "#00ff00"],
      [180, "#00ffff"],
      [240, "#0000ff"],
      [300, "#ff00ff"],
      [360, "#ff0000"],
    ]) {
      expect(toCssColour(parseColour(`hsl(${hue}, 100%, 50%)`))).toBe(expected);
    }
    expect(parseColour("hsla(210, 40%, 60%, 0.5)").a).toBe(0.5);
  });

  it("survives a colour written with pieces missing", () => {
    expect(parseColour("rgb(255)")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColour("hsl(210)")).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(parseColour("rgb(50%, 0%, 0%)").r).toBeCloseTo(0.5, 5);
    expect(parseColour("rgb()")).toBeNull();
  });
});

/** Straight-line distance in RGB; near enough for "is this that colour". */
const distance = (a, b) => {
  const from = parseColour(a);
  const to = parseColour(b);
  return Math.hypot(from.r - to.r, from.g - to.g, from.b - to.b);
};

/** How far along the theme's ramp a tinted colour landed, 0 at ink, 1 at ground. */
const rampPosition = (raw, palette) => {
  const { l } = toHsl(parseColour(raw));
  const ground = toHsl(parseColour(palette.land)).l;
  const ink = toHsl(parseColour(palette.label)).l;
  return (l - ink) / (ground - ink);
};

describe("tintColour", () => {
  // The style's own contrast is what makes it legible, so what is preserved is
  // a colour's place on the ramp — how ground-like or ink-like it is — and not
  // its luminance. On a dark theme those are opposites, which is the point:
  // paper-white land has to come out as the theme's near-black ground.
  it("keeps a colour's place on the ramp, inverting luminance on a dark theme", () => {
    expect(rampPosition(tintColour("#f4f2ec", PALETTE), PALETTE)).toBeGreaterThan(
      rampPosition(tintColour("#33312c", PALETTE), PALETTE),
    );
    // The dark theme really did invert: the ground is darker than the ink.
    expect(toHsl(parseColour(PALETTE.land)).l).toBeLessThan(toHsl(parseColour(PALETTE.label)).l);
    expect(toHsl(parseColour(tintColour("#f4f2ec", PALETTE))).l).toBeLessThan(
      toHsl(parseColour(tintColour("#33312c", PALETTE))).l,
    );
  });

  it("puts land on the theme's ground and ink", () => {
    expect(tintColour("#ffffff", PALETTE)).toBe(PALETTE.land);
    expect(tintColour("#000000", PALETTE)).toBe(PALETTE.label);
  });

  // Every sea, lake and river in the style would otherwise flatten to one
  // colour, losing the depth ramp the original draws them with.
  it("gives water a ramp of its own rather than the ground's", () => {
    const shallow = tintColour("#cfe8f5", PALETTE);
    const deep = tintColour("#2b6a8f", PALETTE);

    // Shallow water is all but the theme's own water; deeper water is that
    // pulled towards its ink, so the sea keeps its depth.
    expect(distance(shallow, PALETTE.water)).toBeLessThan(0.08);
    expect(distance(deep, PALETTE.water)).toBeGreaterThan(distance(shallow, PALETTE.water));

    // And it is water it is made of, not ground: a theme whose water changes
    // moves it, a theme whose ground changes does not.
    expect(tintColour("#2b6a8f", { ...PALETTE, water: "#7a2b2b" })).not.toBe(deep);
    expect(tintColour("#2b6a8f", { ...PALETTE, land: "#7a2b2b" })).toBe(deep);
  });

  it("does not mistake a pale wash for water", () => {
    // Near-grey: a hue in the blue range but no saturation to speak of.
    expect(tintColour("#f0f1f2", PALETTE)).toBe(tintColour("#f1f1f1", PALETTE));
  });

  it("carries transparency through, so halos stay halos", () => {
    expect(tintColour("#ffffff80", PALETTE)).toBe("rgba(16, 29, 40, 0.502)");
  });

  it("leaves a value it cannot read untouched", () => {
    expect(tintColour("transparent", PALETTE)).toBe("transparent");
    expect(tintColour("#ffffff", { land: "not a colour" })).toBe("#ffffff");
  });
});

describe("tintMapStyle", () => {
  const style = {
    version: 8,
    name: "Gallery",
    sources: { openmaptiles: { url: "https://tiles.openfreemap.org/planet" } },
    sprite: "{{origin}}/map-styles/gallery/sprite",
    layers: [
      { id: "ground", type: "background", paint: { "background-color": "#ffffff" } },
      {
        id: "roads",
        type: "line",
        paint: {
          "line-color": ["interpolate", ["linear"], ["zoom"], 5, "#ffffff", 12, "#eeeeee"],
          "line-width": 4,
        },
      },
      {
        id: "labels",
        type: "symbol",
        layout: { "text-font": ["Noto Sans Regular"], "text-field": ["get", "name"] },
        paint: { "text-color": "#000000", "text-halo-width": 1.2 },
      },
      { id: "no-paint", type: "line" },
    ],
  };

  const tinted = tintMapStyle(style, PALETTE, "Theme (slate)");

  it("keeps the cartography and changes only the palette", () => {
    expect(tinted.layers.map((layer) => layer.id)).toEqual(style.layers.map((layer) => layer.id));
    expect(tinted.sources).toEqual(style.sources);
    expect(tinted.sprite).toBe(style.sprite);
    expect(tinted.name).toBe("Theme (slate)");
  });

  it("retints colours wherever they are, including inside expressions", () => {
    expect(tinted.layers[0].paint["background-color"]).toBe(PALETTE.land);
    expect(tinted.layers[1].paint["line-color"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      5,
      PALETTE.land,
      12,
      expect.stringMatching(/^#/),
    ]);
    expect(tinted.layers[2].paint["text-color"]).toBe(PALETTE.label);
  });

  // A width is a number and a font is a name: a blanket walk over paint would
  // turn "Noto Sans Regular" into a colour lookup, which is how the first font
  // remapping broke.
  it("touches nothing that is not a colour", () => {
    expect(tinted.layers[1].paint["line-width"]).toBe(4);
    expect(tinted.layers[2].paint["text-halo-width"]).toBe(1.2);
    expect(tinted.layers[2].layout).toEqual(style.layers[2].layout);
    expect(tinted.layers[3]).toEqual(style.layers[3]);
  });

  // The gallery style is old enough to use the function form in places, so a
  // colour can be nested inside a `stops` object rather than an expression.
  it("reaches a colour inside the legacy stops form", () => {
    const legacy = tintMapStyle(
      {
        layers: [
          { id: "land", type: "fill", paint: { "fill-color": { stops: [[10, "#ffffff"]] } } },
        ],
      },
      PALETTE,
    );

    expect(legacy.layers[0].paint["fill-color"]).toEqual({ stops: [[10, PALETTE.land]] });
  });

  it("keeps its own name when it is not given one", () => {
    expect(tintMapStyle(style, PALETTE).name).toBe("Gallery");
  });
});
