import { formatAspectRatio } from "./formatAspectRatio";

describe("formatAspectRatio", () => {
  it.each([
    [6000, 4000, "3:2"],
    [4000, 6000, "2:3"],
    [3200, 3200, "1:1"],
    [1920, 1080, "16:9"],
    [4432, 2955, "≈1.50:1"],
    [2955, 4432, "≈1:1.50"],
    [0, 4000, "—"],
    [6000, Number.NaN, "—"],
  ])("formats %i × %i as %s", (width, height, expected) => {
    expect(formatAspectRatio(width, height)).toBe(expected);
  });
});
