import {
  assignCrosswordPhotos,
  buildPhotoCrossword,
  checkPhotoCrossword,
  checkHiddenCrossword,
  crosswordSeedIndices,
  resolveHiddenCrossword,
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
it.each([3, 4, 5] as const)(
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
    expect(
      [...puzzle.rows, ...puzzle.columns].every((question) =>
        puzzle.solution.some((photo) => !question.matches(photo)),
      ),
    ).toBe(true);
  },
);

it.each([3, 4, 5] as const)(
  "provides the requested total of unique fixed shots on a %i grid",
  (size) => {
    for (const count of [0, 1, 2, 3, 4] as const) {
      const indices = crosswordSeedIndices(size, count);
      expect(indices).toHaveLength(count);
      expect(new Set(indices).size).toBe(count);
      expect(indices.every((index) => index >= 0 && index < size ** 2)).toBe(true);
      if (count <= size) {
        expect(new Set(indices.map((index) => Math.floor(index / size))).size).toBe(count);
        expect(new Set(indices.map((index) => index % size)).size).toBe(count);
      }
    }
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

it("requires twenty-five distinct photographs for a 5×5 board", () => {
  expect(buildPhotoCrossword([...photos, ...photos], 5)).toBeNull();
});

it("accepts inferred row and column order while visible clues retain their positions", () => {
  const puzzle: PhotoCrosswordPuzzle = {
    size: 3,
    rows: rows.map(tag),
    columns: columns.map(tag),
    solution: photos,
    tiles: photos,
  };
  const reordered = [2, 0, 1].flatMap((row) =>
    [1, 2, 0].map((column) => photos[row * 3 + column]!),
  );
  expect(checkPhotoCrossword(puzzle, reordered).every(Boolean)).toBe(false);
  const resolved = resolveHiddenCrossword(puzzle, reordered)!;
  expect(resolved.rows.map((question) => question.id)).toEqual(["triangle", "round", "square"]);
  expect(resolved.columns.map((question) => question.id)).toEqual(["azure", "golden", "scarlet"]);
  expect(checkPhotoCrossword(resolved, reordered).every(Boolean)).toBe(true);
});

it("accepts transposed hidden connections but rejects incomplete, reused or unavailable photographs", () => {
  const puzzle: PhotoCrosswordPuzzle = {
    size: 3,
    rows: rows.map(tag),
    columns: columns.map(tag),
    solution: photos,
    tiles: photos,
  };
  const transposed = columns.flatMap((_, column) =>
    rows.map((_, row) => photos[row * 3 + column]!),
  );
  const resolved = resolveHiddenCrossword(puzzle, transposed)!;
  expect(resolved.rows.map((question) => question.id)).toEqual(columns);
  expect(checkPhotoCrossword(resolved, transposed).every(Boolean)).toBe(true);
  expect(resolveHiddenCrossword(puzzle, photos.slice(1))).toBeNull();
  expect(resolveHiddenCrossword(puzzle, [...photos.slice(0, -1), photos[0]!])).toBeNull();
  expect(
    resolveHiddenCrossword(puzzle, [
      ...photos.slice(0, -1),
      { ...photos.at(-1)!, path: "missing.jpg" },
    ]),
  ).toBeNull();
});

it("anchors only hinted lines while the remaining hidden clues can change order", () => {
  const puzzle: PhotoCrosswordPuzzle = {
    size: 3,
    rows: rows.map(tag),
    columns: columns.map(tag),
    solution: photos,
    tiles: photos,
  };
  const reordered = [0, 2, 1].flatMap((row) =>
    [0, 2, 1].map((column) => photos[row * 3 + column]!),
  );
  expect(
    resolveHiddenCrossword(puzzle, reordered, [
      { axis: "row", index: 0 },
      { axis: "column", index: 0 },
    ]),
  ).not.toBeNull();
  expect(resolveHiddenCrossword(puzzle, reordered, [{ axis: "row", index: 1 }])).toBeNull();
  expect(resolveHiddenCrossword(puzzle, reordered, [{ axis: "column", index: 1 }])).toBeNull();
  const transposed = columns.flatMap((_, column) =>
    rows.map((_, row) => photos[row * 3 + column]!),
  );
  expect(resolveHiddenCrossword(puzzle, transposed, [{ axis: "row", index: 0 }])).toBeNull();
});

it("checks partial hidden connections without imposing a secret ordering", () => {
  const puzzle: PhotoCrosswordPuzzle = {
    size: 3,
    rows: rows.map(tag),
    columns: columns.map(tag),
    solution: photos,
    tiles: photos,
  };
  const cells: Array<PhotoGamePhoto | null> = Array(9).fill(null);
  cells[3] = photos[0]!;
  cells[4] = photos[1]!;
  expect(checkHiddenCrossword(puzzle, cells)).toBe(true);
  expect(checkHiddenCrossword(puzzle, cells, [{ axis: "row", index: 1 }])).toBe(false);
  cells[4] = photos[4]!;
  expect(checkHiddenCrossword(puzzle, cells)).toBe(false);
  cells[4] = photos[0]!;
  expect(checkHiddenCrossword(puzzle, cells)).toBe(false);
  cells[4] = { ...photos[1]!, path: "missing.jpg" };
  expect(checkHiddenCrossword(puzzle, cells)).toBe(false);
});
