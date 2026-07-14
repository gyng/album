import {
  deltaE,
  hexToRgb,
  minColorDistance,
  parseColorPalette,
  rgbToHex,
  rgbToLab,
  rgbToString,
} from "./colorDistance";

describe("hexToRgb", () => {
  it("parses a 6-digit hex string", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
    expect(hexToRgb("#0a141e")).toEqual([10, 20, 30]);
  });

  it("parses 3-digit shorthand hex (e.g. #abc)", () => {
    expect(hexToRgb("#abc")).toEqual([0xaa, 0xbb, 0xcc]);
    expect(hexToRgb("#000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
  });

  it("accepts values with or without a leading hash", () => {
    expect(hexToRgb("ff0000")).toEqual([255, 0, 0]);
    expect(hexToRgb("abc")).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it("returns null for malformed hex", () => {
    expect(hexToRgb("#12")).toBeNull();
    expect(hexToRgb("#gggggg")).toBeNull();
    expect(hexToRgb("#12g")).toBeNull();
    expect(hexToRgb("#1234567")).toBeNull();
  });
});

describe("rgbToHex / rgbToString round-trips", () => {
  it("serialises RGB tuples", () => {
    expect(rgbToHex([255, 0, 0])).toBe("#ff0000");
    expect(rgbToString([12, 34, 56])).toBe("rgb(12, 34, 56)");
  });
});

describe("rgbToLab", () => {
  it("maps black to the LAB origin and white to full lightness", () => {
    expect(rgbToLab(0, 0, 0)).toEqual([0, 0, 0]);
    expect(rgbToLab(255, 255, 255)[0]).toBeCloseTo(100, 4);
  });
});

describe("parseColorPalette", () => {
  it("deserialises the Python tuple format", () => {
    expect(parseColorPalette("[(12, 34, 56), (78, 90, 12)]")).toEqual([
      [12, 34, 56],
      [78, 90, 12],
    ]);
  });

  it("returns an empty array for malformed input", () => {
    expect(parseColorPalette("not a palette")).toEqual([]);
    expect(parseColorPalette("")).toEqual([]);
  });
});

describe("minColorDistance", () => {
  it("returns Infinity for an empty palette", () => {
    expect(minColorDistance([255, 0, 0], [])).toBe(Infinity);
  });

  it("returns the distance to the closest palette entry, not the first", () => {
    const query: [number, number, number] = [255, 0, 0];
    const palette: [number, number, number][] = [
      [0, 0, 255], // far (blue)
      [250, 5, 5], // close (near red)
    ];
    const closest = minColorDistance(query, palette);
    const toFirst = deltaE(rgbToLab(...query), rgbToLab(...palette[0]));
    expect(closest).toBeLessThan(toFirst);
    // The closest entry drives the distance.
    expect(closest).toBeCloseTo(deltaE(rgbToLab(...query), rgbToLab(...palette[1])), 5);
  });

  it("is zero for an identical colour present in the palette", () => {
    expect(
      minColorDistance(
        [10, 20, 30],
        [
          [200, 200, 200],
          [10, 20, 30],
        ],
      ),
    ).toBe(0);
  });

  it("keeps the best match when later palette entries are farther away", () => {
    expect(
      minColorDistance(
        [10, 20, 30],
        [
          [10, 20, 30],
          [250, 250, 250],
        ],
      ),
    ).toBe(0);
  });
});
