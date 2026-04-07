import {
  computeScore,
  computeTimeBonus,
  formatDistance,
  scoreRatio,
  scoreTierColour,
  MAX_SCORE,
  ZERO_DISTANCE,
  MAX_TIME_BONUS,
} from "./guessScoring";
import { seededShuffle } from "../search/api";

describe("computeScore", () => {
  it("returns MAX_SCORE for 0 km", () => {
    expect(computeScore(0)).toBe(MAX_SCORE);
  });

  it("returns 0 at the ZERO_DISTANCE threshold", () => {
    expect(computeScore(ZERO_DISTANCE)).toBe(0);
  });

  it("returns 0 for distances beyond the threshold", () => {
    expect(computeScore(1000)).toBe(0);
    expect(computeScore(5000)).toBe(0);
  });

  it("is monotonically decreasing", () => {
    const distances = [0, 1, 10, 50, 100, 200, 300, 400, 500];
    const scores = distances.map(computeScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("rewards neighbourhood precision — 10 km scores above 60%", () => {
    expect(computeScore(10)).toBeGreaterThan(MAX_SCORE * 0.6);
  });

  it("punishes wrong-region guesses — 200 km is below 30%", () => {
    expect(computeScore(200)).toBeLessThan(MAX_SCORE * 0.3);
  });

  it("returns 0 for very large distances", () => {
    expect(computeScore(999999)).toBe(0);
  });
});

describe("computeTimeBonus", () => {
  it("returns 0 when timer is off", () => {
    expect(computeTimeBonus(null, null)).toBe(0);
    expect(computeTimeBonus(null, 10)).toBe(0);
  });

  it("returns MAX_TIME_BONUS for instant answer", () => {
    expect(computeTimeBonus(30, 30)).toBe(MAX_TIME_BONUS);
  });

  it("returns 0 when time runs out", () => {
    expect(computeTimeBonus(30, 0)).toBe(0);
  });

  it("scales linearly with time remaining", () => {
    expect(computeTimeBonus(30, 15)).toBe(500);
    expect(computeTimeBonus(30, 10)).toBe(333);
  });

  it("works with 15-second timer", () => {
    expect(computeTimeBonus(15, 15)).toBe(MAX_TIME_BONUS);
    expect(computeTimeBonus(15, 0)).toBe(0);
  });
});

describe("formatDistance", () => {
  it("formats metres for short distances", () => {
    expect(formatDistance(50)).toBe("50 m");
    expect(formatDistance(999)).toBe("999 m");
  });

  it("formats km with one decimal for medium distances", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(12345)).toBe("12.3 km");
    expect(formatDistance(99999)).toBe("100.0 km");
  });

  it("formats km with thousands separator for large distances", () => {
    expect(formatDistance(100000)).toBe("100 km");
    expect(formatDistance(1234567)).toBe("1,235 km");
  });
});

describe("scoreRatio", () => {
  it("returns 0 for 0 score", () => {
    expect(scoreRatio(0)).toBe(0);
  });

  it("returns 1 for MAX_SCORE", () => {
    expect(scoreRatio(MAX_SCORE)).toBe(1);
  });
});

describe("scoreTierColour", () => {
  it("returns green for high scores", () => {
    expect(scoreTierColour(MAX_SCORE * 0.8)).toBe("#22c55e");
  });

  it("returns amber for medium scores", () => {
    expect(scoreTierColour(MAX_SCORE * 0.4)).toBe("#eab308");
  });

  it("returns accent for low scores", () => {
    expect(scoreTierColour(MAX_SCORE * 0.1)).toBe("var(--c-accent)");
  });
});

describe("seededShuffle", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("returns the same order for the same seed", () => {
    const a = seededShuffle(items, "test-seed");
    const b = seededShuffle(items, "test-seed");
    expect(a).toEqual(b);
  });

  it("returns a different order for a different seed", () => {
    const a = seededShuffle(items, "seed-a");
    const b = seededShuffle(items, "seed-b");
    expect(a).not.toEqual(b);
  });

  it("preserves all elements (no duplicates, no losses)", () => {
    const result = seededShuffle(items, "any-seed");
    expect(result.sort((a, b) => a - b)).toEqual(items);
  });

  it("does not mutate the input array", () => {
    const original = [...items];
    seededShuffle(items, "mutate-check");
    expect(items).toEqual(original);
  });

  it("handles empty arrays", () => {
    expect(seededShuffle([], "empty")).toEqual([]);
  });

  it("handles single-element arrays", () => {
    expect(seededShuffle([42], "single")).toEqual([42]);
  });

  it("produces a deterministic daily seed", () => {
    const a = seededShuffle(items, "daily-2026-04-08");
    const b = seededShuffle(items, "daily-2026-04-08");
    const c = seededShuffle(items, "daily-2026-04-09");
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
