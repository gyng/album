import {
  assignCrosswordPhotos,
  buildPhotoCrossword,
  checkPhotoCrossword,
  type PhotoCrosswordPuzzle,
} from "./photoCrossword";
import type { PhotoGamePhoto, OracleQuestion } from "./photoGames";
const photo = (id: string, tags = ""): PhotoGamePhoto => ({
  path: `../albums/test-simple/${id}.jpg`,
  href: `/album/test-simple#${id}.jpg`,
  caption: "A photograph",
  tags,
  vector: [],
});
const tag = (id: string): OracleQuestion => ({
  id,
  label: `Does it feature ${id}?`,
  matches: (p) => p.tags.split(",").includes(id),
});
const rows = ["round", "square", "triangle"];
const columns = ["scarlet", "azure", "golden"];
const photos = rows.flatMap((row, r) =>
  columns.map((column, c) => photo(`${r}-${c}`, `${row},${column}`)),
);
it("moves an earlier assignment to satisfy a constrained later cell", () => {
  const a = photo("a"),
    b = photo("b");
  expect(assignCrosswordPhotos([[a, b], [a]])?.map((p) => p.path)).toEqual([b.path, a.path]);
  expect(assignCrosswordPhotos([[a], [a]])).toBeNull();
});
it.each([3, 4] as const)(
  "builds a distinct %i by %i board with a valid non-repeating solution",
  (size) => {
    const pool = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) =>
        photo(
          `${r}-${c}`,
          `row_${String.fromCharCode(97 + r)},column_${String.fromCharCode(97 + c)}`,
        ),
      ),
    ).flat();
    const puzzle = buildPhotoCrossword(
      pool,
      size,
      (() => {
        let seed = 7;
        return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      })(),
    )!;
    expect(puzzle).not.toBeNull();
    expect(new Set(puzzle.solution.map((p) => p.path)).size).toBe(size ** 2);
    expect(checkPhotoCrossword(puzzle, puzzle.solution).every(Boolean)).toBe(true);
    expect(
      new Set(
        [...puzzle.rows, ...puzzle.columns].map((q) =>
          puzzle.solution.map((p) => +q.matches(p)).join(""),
        ),
      ).size,
    ).toBe(size * 2);
  },
);
it("accepts alternative valid placements but rejects reused photographs", () => {
  const pool = photos.map((p) =>
    p.path.endsWith("0-0.jpg") || p.path.endsWith("1-0.jpg")
      ? { ...p, tags: `${p.tags},round,square` }
      : p,
  );
  const puzzle: PhotoCrosswordPuzzle = {
    size: 3,
    rows: rows.map(tag),
    columns: columns.map(tag),
    solution: pool,
    tiles: pool,
  };
  const alternative = [...pool];
  [alternative[0], alternative[3]] = [alternative[3]!, alternative[0]!];
  expect(checkPhotoCrossword(puzzle, alternative).every(Boolean)).toBe(true);
  alternative[3] = alternative[0]!;
  expect(checkPhotoCrossword(puzzle, alternative)[0]).toBe(false);
  expect(checkPhotoCrossword(puzzle, alternative)[3]).toBe(false);
});
it("declines a pool with no distinct crossing clues", () => {
  expect(buildPhotoCrossword(photos.map((p) => ({ ...p, tags: "same" })))).toBeNull();
});
