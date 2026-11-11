import { formatMediaCount, formatMediaCountOf } from "./mediaCount";

describe("formatMediaCount", () => {
  it("names photos and clips separately", () => {
    expect(formatMediaCount(12, 0)).toBe("12 photos");
    expect(formatMediaCount(1, 0)).toBe("1 photo");
    expect(formatMediaCount(0, 0)).toBe("0 photos");
    expect(formatMediaCount(0, 3)).toBe("3 clips");
    expect(formatMediaCount(12, 1)).toBe("12 photos and 1 clip");
    expect(formatMediaCount(1234, 0)).toBe("1,234 photos");
  });

  it("counts a list by its media kinds", () => {
    expect(formatMediaCountOf([{}, { mediaKind: "video" }, {}])).toBe("2 photos and 1 clip");
  });
});
