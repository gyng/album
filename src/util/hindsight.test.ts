import {
  buildHindsightPuzzle,
  formatHindsightGap,
  hindsightTrip,
  scoreHindsight,
  HINDSIGHT_MIN_GAP_MS,
  HINDSIGHT_TRIP_WINDOW_MS,
  HINDSIGHT_YEARS_MIN_GAP_MS,
  type HindsightPhoto,
} from "./hindsight";
import { exifWallClockTimestamp } from "./exifTime";
import type { PhotoGamePhoto } from "./photoGames";
import { seededRandom } from "./seededRandom";

const photo = (album: string, name: string, takenAt?: string): PhotoGamePhoto => ({
  path: `../albums/${album}/${name}.jpg`,
  href: `/album/${album}#${name}.jpg`,
  caption: name,
  tags: "",
  vector: [],
  ...(takenAt === undefined ? {} : { takenAt }),
});

// Twelve trips, one a year, each with a dozen photographs an hour apart.
const archive: PhotoGamePhoto[] = Array.from({ length: 12 }, (_, year) =>
  Array.from({ length: 12 }, (_, hour) =>
    photo(
      `trip-${2012 + year}`,
      `p${hour}`,
      `${2012 + year}-0${1 + (year % 9)}-14T${String(8 + hour).padStart(2, "0")}:05:00`,
    ),
  ),
).flat();

const times = (photos: readonly HindsightPhoto[]) => photos.map((item) => item.time);

describe("buildHindsightPuzzle", () => {
  it("deals the same hand for the same seed", () => {
    const a = buildHindsightPuzzle(archive, { size: 5, spread: "years" }, seededRandom("x"));
    const b = buildHindsightPuzzle(archive, { size: 5, spread: "years" }, seededRandom("x"));
    expect(a).not.toBeNull();
    expect(a!.hand.map((item) => item.path)).toEqual(b!.hand.map((item) => item.path));
  });

  it.each([4, 5, 6] as const)("deals %i photographs at least three months apart", (size) => {
    for (const seed of ["a", "b", "c", "d"]) {
      const puzzle = buildHindsightPuzzle(archive, { size, spread: "years" }, seededRandom(seed))!;
      expect(puzzle.hand).toHaveLength(size);
      const sorted = times(puzzle.solution);
      expect(sorted).toEqual([...sorted].sort((x, y) => x - y));
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(HINDSIGHT_YEARS_MIN_GAP_MS);
    }
  });

  it("deals one trip from one album, within two weeks, with no near-ties", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const puzzle = buildHindsightPuzzle(
        archive,
        { size: 6, spread: "trip" },
        seededRandom(seed),
      )!;
      expect(new Set(puzzle.hand.map(hindsightTrip)).size).toBe(1);
      const sorted = times(puzzle.solution);
      expect(sorted.at(-1)! - sorted[0]!).toBeLessThanOrEqual(HINDSIGHT_TRIP_WINDOW_MS);
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(HINDSIGHT_MIN_GAP_MS);
    }
  });

  it("rejects ties, near-ties and photographs without a usable date", () => {
    const crowded = [
      photo("t", "a", "2020-01-01T10:00:00"),
      photo("t", "b", "2020-01-01T10:00:00"),
      photo("t", "c", "2020-01-01T10:03:00"),
      photo("t", "d", "2020-01-01T10:20:00"),
      photo("t", "e"),
      photo("t", "f", "not a date"),
      photo("t", "g", "2020-01-01T11:00:00"),
    ];
    expect(buildHindsightPuzzle(crowded, { size: 4, spread: "trip" }, seededRandom("x"))).toBe(
      null,
    );
    const fair = buildHindsightPuzzle(
      [...crowded, photo("t", "h", "2020-01-02T09:00:00")],
      { size: 4, spread: "trip" },
      seededRandom("x"),
    )!;
    expect(fair.hand.map((item) => item.caption)).not.toContain("e");
    expect(fair.hand.map((item) => item.caption)).not.toContain("f");
    const sorted = times(fair.solution);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(HINDSIGHT_MIN_GAP_MS);
  });

  it("orders by the camera's wall clock and never deals a hand already in order", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const puzzle = buildHindsightPuzzle(
        archive,
        { size: 4, spread: "trip" },
        seededRandom(seed),
      )!;
      expect(times(puzzle.hand)).not.toEqual(times(puzzle.solution));
      for (const item of puzzle.solution)
        expect(item.time).toBe(exifWallClockTimestamp(item.takenAt));
    }
  });

  it("returns null when the archive is too small or too close together", () => {
    expect(buildHindsightPuzzle(archive.slice(0, 12), { size: 4, spread: "years" })).toBeNull();
    expect(buildHindsightPuzzle([], { size: 4, spread: "trip" })).toBeNull();
  });
});

describe("scoreHindsight", () => {
  const solution = buildHindsightPuzzle(
    archive,
    { size: 5, spread: "years" },
    seededRandom("s"),
  )!.solution;

  it("scores a perfect order as every pair in order", () => {
    expect(scoreHindsight(solution, solution)).toEqual({
      pairs: 10,
      inOrder: 10,
      inPlace: 5,
      score: 100,
      perfect: true,
    });
  });

  it("scores a reversed order as no pairs in order", () => {
    expect(scoreHindsight(solution, [...solution].reverse())).toMatchObject({
      inOrder: 0,
      inPlace: 1,
      score: 0,
      perfect: false,
    });
  });

  it("counts the share of pairs in order, not only exact places", () => {
    // Swapping one neighbouring pair breaks one of ten pairs, though two
    // photographs leave their places.
    const swapped = [solution[1]!, solution[0]!, ...solution.slice(2)];
    expect(scoreHindsight(solution, swapped)).toMatchObject({
      inOrder: 9,
      inPlace: 3,
      score: 90,
    });
    // Moving the oldest to the end breaks four pairs, yet no photograph is in place.
    const rotated = [...solution.slice(1), solution[0]!];
    expect(scoreHindsight(solution, rotated)).toMatchObject({ inOrder: 6, inPlace: 0, score: 60 });
  });
});

describe("formatHindsightGap", () => {
  it.each([
    [12 * 60_000, "12 minutes later"],
    [60 * 60_000, "1 hour later"],
    [5 * 3_600_000, "5 hours later"],
    [36 * 3_600_000, "1 day later"],
    [9 * 86_400_000, "9 days later"],
    [75 * 86_400_000, "2 months later"],
    [400 * 86_400_000, "1 year later"],
    [3 * 365.25 * 86_400_000, "3 years later"],
  ])("describes %d ms as %s", (gap, label) => {
    expect(formatHindsightGap(gap)).toBe(label);
  });
});
