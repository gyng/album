const {
  paletteFromColours,
  coloursFromPaletteStrings,
  MINIMUM_CONTRAST,
} = require("./photoPalette.cjs");
const { parseColour, toHsl } = require("./tintMapStyle.cjs");

const lightnessOf = (hex) => toHsl(parseColour(hex)).l;
const hueOf = (hex) => toHsl(parseColour(hex)).h;

const many = (rgb, count) => Array.from({ length: count }, () => ({ rgb }));

describe("coloursFromPaletteStrings", () => {
  it("reads the indexer's own tuple format", () => {
    const colours = coloursFromPaletteStrings(["[(10, 20, 30), (200, 210, 220)]"]);

    expect(colours.map((colour) => colour.rgb)).toEqual([
      [10, 20, 30],
      [200, 210, 220],
    ]);
  });

  // A photograph's first colour is what the photograph looks like; its ninth is
  // a corner of it.
  it("weights a photograph's dominant colour above the rest", () => {
    const colours = coloursFromPaletteStrings(["[(10, 20, 30), (200, 210, 220)]"]);

    expect(colours[0].weight).toBeGreaterThan(colours[1].weight);
  });

  it("ignores a row it cannot read", () => {
    expect(coloursFromPaletteStrings(["", "not a palette", null])).toEqual([]);
  });
});

describe("paletteFromColours", () => {
  it("has nothing to say about an empty corpus", () => {
    expect(paletteFromColours([])).toBeNull();
    expect(paletteFromColours([{ rgb: null }])).toBeNull();
  });

  // The point of the whole thing: the ground is a colour that was actually
  // photographed, not an average of everything, which is mud every time.
  it("takes the commonest light tone as the ground and the commonest dark one as the ink", () => {
    const palette = paletteFromColours([
      ...many([238, 228, 205], 40), // warm paper: the ground
      ...many([34, 28, 24], 30), // near-black: the ink
      ...many([120, 60, 200], 1), // a single loud outlier
    ]);

    expect(lightnessOf(palette.land)).toBeGreaterThan(0.7);
    expect(lightnessOf(palette.label)).toBeLessThan(0.2);
    // Warm ground, from warm photographs.
    expect(hueOf(palette.land)).toBeGreaterThan(20);
    expect(hueOf(palette.land)).toBeLessThan(60);
  });

  // Strictly by weight the ground is whatever tone is commonest, which in a
  // photographic archive is concrete and overcast sky. A tone with actual
  // chroma takes it instead when the collection has plenty of that tone.
  it("prefers a ground with some colour in it over the commonest grey", () => {
    const palette = paletteFromColours([
      ...many([179, 179, 179], 40), // neutral grey: commonest
      ...many([213, 193, 178], 14), // warm sand: a quarter as common, and a colour
      ...many([28, 27, 25], 20),
    ]);

    expect(hueOf(palette.land)).toBeGreaterThan(10);
    expect(hueOf(palette.land)).toBeLessThan(60);
  });

  // But not a colour the archive barely has: one warm frame in a thousand grey
  // ones is not what the collection looks like.
  it("keeps the grey when the colourful tone is rare", () => {
    const palette = paletteFromColours([
      ...many([179, 179, 179], 60),
      ...many([213, 193, 178], 2),
      ...many([28, 27, 25], 20),
    ]);

    expect(toHsl(parseColour(palette.land)).s).toBeLessThan(0.05);
  });

  it("finds the sea in the photographs when there is one", () => {
    const palette = paletteFromColours([
      ...many([240, 236, 226], 30),
      ...many([30, 26, 22], 25),
      ...many([70, 120, 165], 20), // sea
      ...many([180, 60, 60], 5), // something red, and less of it
    ]);

    expect(hueOf(palette.water)).toBeGreaterThan(180);
    expect(hueOf(palette.water)).toBeLessThan(240);
  });

  it("falls back to the corpus's most saturated colour when nothing is blue", () => {
    const palette = paletteFromColours([
      ...many([240, 232, 220], 30),
      ...many([28, 24, 20], 20),
      ...many([200, 90, 40], 15), // orange: the only saturated thing here
    ]);

    expect(hueOf(palette.water)).toBeGreaterThan(10);
    expect(hueOf(palette.water)).toBeLessThan(45);
  });

  // A corpus shot entirely at night would otherwise produce a map of one
  // colour: faithful, and unreadable.
  it("forces ground and ink apart when the photographs are all one tone", () => {
    const palette = paletteFromColours([...many([44, 42, 40], 50), ...many([52, 50, 48], 40)]);

    expect(Math.abs(lightnessOf(palette.land) - lightnessOf(palette.label))).toBeGreaterThanOrEqual(
      MINIMUM_CONTRAST - 0.001,
    );
  });

  it("keeps the contrast the photographs already have", () => {
    const palette = paletteFromColours([...many([250, 250, 250], 20), ...many([5, 5, 5], 20)]);

    expect(lightnessOf(palette.land)).toBeGreaterThan(0.9);
    expect(lightnessOf(palette.label)).toBeLessThan(0.1);
  });

  it("still answers when every photograph is bright, or every one is dark", () => {
    const bright = paletteFromColours(many([250, 248, 240], 10));
    const dark = paletteFromColours(many([12, 10, 8], 10));

    for (const palette of [bright, dark]) {
      expect(palette.land).toMatch(/^#|^rgba/);
      expect(Math.abs(lightnessOf(palette.land) - lightnessOf(palette.label))).toBeGreaterThan(0);
    }
  });
});
