import {
  FOUND_RANK,
  captionProblem,
  normaliseGuess,
  scoreTextAgainstArchive,
  warmerBlur,
  warmerTemperature,
} from "./semanticGames";
import type { PhotoGamePhoto } from "./photoGames";

const photo = (path: string, vector: number[]): PhotoGamePhoto => ({
  path,
  href: `/album/a#${path}`,
  caption: `A photograph called ${path}`,
  tags: "",
  vector,
});

const archive = [
  photo("bike", [1, 0, 0]),
  photo("boat", [0, 1, 0]),
  photo("tree", [0, 0, 1]),
  photo("bridge", [0.7, 0.7, 0]),
];

describe("scoreTextAgainstArchive", () => {
  it("ranks the target among the archive's photographs, not by raw similarity", () => {
    const result = scoreTextAgainstArchive([1, 0, 0], archive, "bike");
    expect(result).toMatchObject({ rank: 1, total: 4, found: true });
    expect(result!.nearest.path).toBe("bike");
  });

  it("is not found when other photographs fit the text better", () => {
    const result = scoreTextAgainstArchive([0, 0.2, 1], archive, "bike");
    expect(result!.rank).toBeGreaterThan(FOUND_RANK);
    expect(result!.found).toBe(false);
  });

  it("is null when the vector cannot be compared", () => {
    expect(scoreTextAgainstArchive([0, 0, 0], archive, "bike")).toBeNull();
    expect(scoreTextAgainstArchive([1, 0, 0], archive, "missing")).toBeNull();
  });
});

describe("warmerTemperature", () => {
  it("runs from freezing to found as the rank climbs", () => {
    expect(warmerTemperature(1, 1000).id).toBe("found");
    expect(warmerTemperature(FOUND_RANK, 1000).id).toBe("found");
    expect(warmerTemperature(8, 1000).id).toBe("burning");
    expect(warmerTemperature(40, 1000).id).toBe("hot");
    expect(warmerTemperature(120, 1000).id).toBe("warm");
    expect(warmerTemperature(300, 1000).id).toBe("tepid");
    expect(warmerTemperature(550, 1000).id).toBe("cool");
    expect(warmerTemperature(900, 1000).id).toBe("freezing");
  });

  it("means the same thing for archives of different sizes", () => {
    expect(warmerTemperature(40, 1000).id).toBe(warmerTemperature(80, 2000).id);
  });
});

describe("warmerBlur", () => {
  it("starts fully blurred and clears as the best guess closes in", () => {
    const start = warmerBlur(null, 1000);
    const warm = warmerBlur(150, 1000);
    const hot = warmerBlur(20, 1000);
    expect(start).toBeGreaterThan(warm);
    expect(warm).toBeGreaterThan(hot);
    expect(warmerBlur(1, 1000)).toBe(0);
  });
});

describe("normaliseGuess", () => {
  it("compares guesses without case or spacing", () => {
    expect(normaliseGuess("  Red   Bicycle ")).toBe("red bicycle");
  });
});

describe("captionProblem", () => {
  it("accepts an ordinary caption", () => {
    expect(captionProblem("A red bicycle leaning on a canal railing")).toBeNull();
  });

  it("asks for more than one word", () => {
    expect(captionProblem("bicycle")).toMatch(/two words/);
  });

  it("refuses a caption stuffed with one word", () => {
    expect(captionProblem("bicycle bicycle bicycle on a bicycle")).toMatch(/once/);
  });
});
