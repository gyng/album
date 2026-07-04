import {
  recencyColor,
  recencyGradientStops,
  recencyGradientCss,
} from "./mapColor";

const parseHsl = (color: string) => {
  const match = color.match(
    /hsl\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\s*\)/,
  );
  if (!match) {
    throw new Error(`not an hsl() colour: ${color}`);
  }
  return {
    hue: Number.parseFloat(match[1] ?? ""),
    saturation: Number.parseFloat(match[2] ?? ""),
    lightness: Number.parseFloat(match[3] ?? ""),
  };
};

describe("recencyColor", () => {
  it("maps the newest end to red and the oldest end to blue", () => {
    expect(parseHsl(recencyColor(1)).hue).toBeCloseTo(0, 1); // red = newer
    expect(parseHsl(recencyColor(0)).hue).toBeCloseTo(220, 1); // blue = older
  });

  it("gets lighter (fades) towards the oldest end", () => {
    // Lightness is the ordered reinforcement: newest is deepest, oldest palest.
    expect(parseHsl(recencyColor(0)).lightness).toBeGreaterThan(
      parseHsl(recencyColor(1)).lightness,
    );
  });

  it("gets more saturated (vivid) towards the newest end", () => {
    expect(parseHsl(recencyColor(1)).saturation).toBeGreaterThan(
      parseHsl(recencyColor(0)).saturation,
    );
  });

  it("varies hue monotonically with recency (red is newer than blue)", () => {
    expect(parseHsl(recencyColor(1)).hue).toBeLessThan(
      parseHsl(recencyColor(0.5)).hue,
    );
    expect(parseHsl(recencyColor(0.5)).hue).toBeLessThan(
      parseHsl(recencyColor(0)).hue,
    );
  });

  it("clamps below-range and non-finite input to the oldest end without NaN", () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const color = recencyColor(value);
      expect(color).not.toContain("NaN");
      expect(parseHsl(color)).toEqual(parseHsl(recencyColor(0)));
    }
  });

  it("clamps above-range input to the newest end", () => {
    expect(parseHsl(recencyColor(2))).toEqual(parseHsl(recencyColor(1)));
  });
});

describe("recencyGradientStops", () => {
  it("returns ordered stops from oldest (0) to newest (1)", () => {
    const stops = recencyGradientStops(5);
    expect(stops).toHaveLength(5);
    expect(stops[0]?.offset).toBe(0);
    expect(stops.at(-1)?.offset).toBe(1);
    // first stop is the oldest colour, last is the newest
    expect(stops[0]?.color).toBe(recencyColor(0));
    expect(stops.at(-1)?.color).toBe(recencyColor(1));
  });

  it("never returns fewer than two stops", () => {
    expect(recencyGradientStops(1)).toHaveLength(2);
    expect(recencyGradientStops(0)).toHaveLength(2);
  });
});

describe("recencyGradientCss", () => {
  it("produces a linear-gradient with the given angle and no NaN", () => {
    const css = recencyGradientCss("90deg", 3);
    expect(css.startsWith("linear-gradient(90deg,")).toBe(true);
    expect(css).not.toContain("NaN");
    expect(css).toContain("0%");
    expect(css).toContain("100%");
  });
});
