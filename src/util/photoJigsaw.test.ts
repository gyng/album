import {
  dealJigsaw,
  jigsawGrid,
  jigsawPieceEdges,
  jigsawPiecePath,
  placeJigsawPiece,
  returnJigsawPiece,
  moveJigsaw,
  rotateJigsaw,
  rotateJigsawPiece,
  jigsawSolved,
  type JigsawState,
} from "./photoJigsaw";

it("four quarter turns restore the same piece without changing its position", () => {
  let state: JigsawState = { tiles: [0, 1, 2, 3], turns: [0, 0, 0, 0], moves: 0 };
  for (let i = 0; i < 4; i++) state = rotateJigsaw(state, 1);
  expect(state.tiles).toEqual([0, 1, 2, 3]);
  expect(state.turns).toEqual([0, 0, 0, 0]);
  expect(state.moves).toBe(4);
});
it("deals a shuffled swap board and detects exact orientation", () => {
  const board = dealJigsaw(3, "swap", () => 0.3);
  expect([...board.tiles].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(jigsawSolved(board)).toBe(false);
  expect(jigsawSolved({ tiles: [0, 1, 2, 3], turns: [0, 0, 0, 0], moves: 0 })).toBe(true);
  expect(jigsawSolved({ tiles: [0, 1, 2, 3], turns: [0, 1, 0, 0], moves: 0 })).toBe(false);
});
it("slides only neighbours into the empty space", () => {
  const s: JigsawState = { tiles: [0, 1, 2, 3, 4, 5, 6, -1, 7], turns: Array(9).fill(0), moves: 0 };
  expect(moveJigsaw(s, 0, 7, "slide", 3)).toBe(s);
  const next = moveJigsaw(s, 8, 7, "slide", 3);
  expect(next.tiles).toEqual([0, 1, 2, 3, 4, 5, 6, 7, -1]);
  expect(jigsawSolved(next)).toBe(true);
});
it("a dealt sliding board is solvable by its inversion parity", () => {
  for (let i = 0; i < 10; i++)
    for (const size of [3, 4]) {
      const s = dealJigsaw(size, "slide");
      const tiles = s.tiles.filter((v) => v !== -1);
      let inversions = 0;
      for (let a = 0; a < tiles.length; a++)
        for (let b = a + 1; b < tiles.length; b++) if (tiles[a]! > tiles[b]!) inversions++;
      const row = size - Math.floor(s.tiles.indexOf(-1) / size);
      expect(size % 2 ? inversions % 2 : (inversions + row) % 2).toBe(size % 2 ? 0 : 1);
      expect(jigsawSolved(s)).toBe(false);
    }
});

it("deals an empty grid with every piece in a shuffled pool", () => {
  const state = dealJigsaw(3, "pool", () => 0.3);
  expect(state.tiles).toEqual(Array(9).fill(-1));
  expect(state.pool?.toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(jigsawSolved(state)).toBe(false);
});
it("places, displaces and returns pieces without losing any", () => {
  let state = dealJigsaw(3, "pool", () => 0.3);
  state = placeJigsawPiece(state, 0, 0);
  expect(state.tiles[0]).toBe(0);
  expect(state.pool).not.toContain(0);
  state = placeJigsawPiece(state, 1, 0);
  expect(state.tiles[0]).toBe(1);
  expect(state.pool).toContain(0);
  state = placeJigsawPiece(state, 1, 1);
  expect(state.tiles[0]).toBe(-1);
  expect(state.tiles[1]).toBe(1);
  state = returnJigsawPiece(state, 1);
  expect(state.tiles[1]).toBe(-1);
  expect(state.pool).toContain(1);
  expect(
    [...state.tiles.filter((t) => t !== -1), ...state.pool!].toSorted((a, b) => a - b),
  ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (let i = 0; i < 9; i++) state = placeJigsawPiece(state, i, i);
  expect(jigsawSolved(state)).toBe(true);
  expect(state.pool).toEqual([]);
  expect(placeJigsawPiece(state, 0, 0)).toBe(state);
});

it.each([3, 4, 5])(
  "cuts complementary internal edges and flat outer edges on a %i×%i jigsaw",
  (size) => {
    for (let piece = 0; piece < size * size; piece++) {
      const [top, right, bottom, left] = jigsawPieceEdges(piece, size);
      const row = Math.floor(piece / size),
        column = piece % size;
      if (row === 0) expect(top).toBe(0);
      else expect(top).toBe(-jigsawPieceEdges(piece - size, size)[2]);
      if (column === 0) expect(left).toBe(0);
      else expect(left).toBe(-jigsawPieceEdges(piece - 1, size)[1]);
      if (row === size - 1) expect(bottom).toBe(0);
      else expect(Math.abs(bottom)).toBe(1);
      if (column === size - 1) expect(right).toBe(0);
      else expect(Math.abs(right)).toBe(1);
      expect(jigsawPiecePath(piece, size)).toMatch(/^M/);
      expect(jigsawPiecePath(piece, size)).toMatch(/Z$/);
    }
    expect(dealJigsaw(size, "jigsaw").pool).toHaveLength(size * size);
  },
);

it.each([2, 6, 8, 10, 12, 20, 50])(
  "deals a custom %i×%i shaped jigsaw without losing pieces",
  (size) => {
    const state = dealJigsaw(size, "jigsaw", () => 0.3);
    expect(state.tiles).toHaveLength(size * size);
    expect(new Set(state.pool).size).toBe(size * size);
    expect(state.pool).toEqual(expect.arrayContaining([0, size * size - 1]));
  },
);
it.each([1, 2.5, NaN, 51])("rejects unsupported jigsaw size %s", (size) => {
  expect(() => dealJigsaw(size, "jigsaw")).toThrow();
});

it.each([
  [1.5, 6, 4],
  [2 / 3, 4, 6],
  [1, 6, 6],
] as const)("adapts a six-piece longest side to aspect ratio %s", (ratio, columns, rows) => {
  expect(jigsawGrid(6, ratio, true)).toEqual({ columns, rows });
  expect(jigsawGrid(6, ratio, false)).toEqual({ columns: 6, rows: 6 });
});
it("cuts and deals rectangular grids with flat outer borders and complementary internal edges", () => {
  const columns = 6,
    rows = 4;
  const state = dealJigsaw(columns, "jigsaw", () => 0.3, rows);
  expect(state.tiles).toHaveLength(24);
  expect(state.pool).toHaveLength(24);
  for (let piece = 0; piece < columns * rows; piece++) {
    const [top, right, bottom, left] = jigsawPieceEdges(piece, columns, rows);
    if (piece < columns) expect(top).toBe(0);
    else expect(top).toBe(-jigsawPieceEdges(piece - columns, columns, rows)[2]);
    if (piece % columns === 0) expect(left).toBe(0);
    else expect(left).toBe(-jigsawPieceEdges(piece - 1, columns, rows)[1]);
    if (piece >= columns * (rows - 1)) expect(bottom).toBe(0);
    if (piece % columns === columns - 1) expect(right).toBe(0);
    expect(jigsawPiecePath(piece, columns, rows)).toMatch(/Z$/);
  }
});

it("retains a piece's rotation through arbitrary placement, swapping and returning to the pool", () => {
  let state = dealJigsaw(3, "jigsaw", () => 0.3);
  state = rotateJigsawPiece(state, 0, 1);
  expect(state.turns[0]).toBe(1);
  state = placeJigsawPiece(state, 0, 5);
  expect(state.tiles[5]).toBe(0);
  expect(state.turns[0]).toBe(1);
  state = placeJigsawPiece(state, 1, 5);
  expect(state.pool).toContain(0);
  expect(state.turns[0]).toBe(1);
  state = placeJigsawPiece(state, 0, 0);
  state = returnJigsawPiece(state, 0);
  expect(state.turns[0]).toBe(1);
  state = rotateJigsawPiece(state, 0, -1);
  expect(state.turns[0]).toBe(0);
  for (let i = 0; i < 9; i++) state = placeJigsawPiece(state, i, i);
  expect(jigsawSolved(state)).toBe(true);
  state = rotateJigsawPiece(state, 0, 1);
  expect(jigsawSolved(state)).toBe(false);
});
