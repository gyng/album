const {
  PATTERNS,
  buildPatternSheet,
  dotScreen,
  grain,
  scanlines,
  hatch,
} = require("./mapPatternSprite.cjs");

const alphaAt = ({ pixels, size }, x, y) => pixels[(y * size + x) * 4 + 3];
const colourAt = ({ pixels, size }, x, y) => {
  const offset = (y * size + x) * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
};

describe("the patterns themselves", () => {
  // A pattern that carried its own colour could serve one style only; black at
  // an alpha darkens whatever is underneath, so an ochre print and a green
  // terminal can share a dot screen.
  it("draws in alpha alone, never in colour", () => {
    for (const make of Object.values(PATTERNS)) {
      const pattern = make();
      for (let y = 0; y < pattern.size; y += 1) {
        for (let x = 0; x < pattern.size; x += 1) {
          expect(colourAt(pattern, x, y)).toEqual([0, 0, 0]);
        }
      }
    }
  });

  it("draws something with no arguments at all", () => {
    for (const make of [dotScreen, grain, scanlines, hatch]) {
      const pattern = make();
      const ink = pattern.pixels.filter((_, index) => index % 4 === 3).reduce((a, b) => a + b, 0);

      expect(pattern.size).toBeGreaterThan(0);
      expect(ink).toBeGreaterThan(0);
    }
  });

  it("puts the dot in the middle of its tile and nothing in the corner", () => {
    const dot = dotScreen({ size: 8, radius: 2, alpha: 1 });

    expect(alphaAt(dot, 4, 4)).toBeGreaterThan(200);
    expect(alphaAt(dot, 0, 0)).toBe(0);
  });

  it("makes a bigger dot a darker tone", () => {
    const total = (pattern) =>
      pattern.pixels.filter((_, i) => i % 4 === 3).reduce((a, b) => a + b, 0);

    expect(total(dotScreen({ size: 8, radius: 3 }))).toBeGreaterThan(
      total(dotScreen({ size: 8, radius: 1 })),
    );
  });

  it("darkens every other row for a scanline", () => {
    const lines = scanlines({ size: 4, alpha: 0.5, lineHeight: 1 });

    expect(alphaAt(lines, 0, 0)).toBeGreaterThan(0);
    expect(alphaAt(lines, 0, 1)).toBe(0);
    expect(alphaAt(lines, 3, 2)).toBeGreaterThan(0);
  });

  it("runs its hatching diagonally", () => {
    const lines = hatch({ size: 8, alpha: 1, spacing: 4 });

    expect(alphaAt(lines, 0, 0)).toBeGreaterThan(0);
    expect(alphaAt(lines, 1, 3)).toBeGreaterThan(0);
    expect(alphaAt(lines, 1, 0)).toBe(0);
  });

  // A build that runs twice has to write the same file, or every deploy ships a
  // new sprite and every reader downloads it again.
  it("grains the paper the same way every time", () => {
    expect(grain({ seed: 7 }).pixels).toEqual(grain({ seed: 7 }).pixels);
    expect(grain({ seed: 7 }).pixels).not.toEqual(grain({ seed: 8 }).pixels);
  });
});

describe("buildPatternSheet", () => {
  const sheet = buildPatternSheet();

  it("indexes every pattern a style can name", () => {
    expect(Object.keys(sheet.index).sort()).toEqual(Object.keys(PATTERNS).sort());
  });

  it("lays them out side by side without overlapping", () => {
    const boxes = Object.values(sheet.index).sort((a, b) => a.x - b.x);

    boxes.reduce((edge, box) => {
      expect(box.x).toBeGreaterThanOrEqual(edge);
      return box.x + box.width;
    }, 0);
    expect(sheet.width).toBe(boxes.reduce((total, box) => total + box.width, 0));
    expect(sheet.height).toBe(Math.max(...boxes.map((box) => box.height)));
    expect(sheet.pixels).toHaveLength(sheet.width * sheet.height * 4);
  });

  it("copies each pattern into its own box", () => {
    const box = sheet.index.scanline;
    const first = sheet.pixels[(box.x + 0) * 4 + 3];

    expect(first).toBe(scanlines({}).pixels[3]);
  });
});
