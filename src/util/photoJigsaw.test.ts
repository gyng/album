import {
  dealJigsaw,
  placeJigsawPiece,
  returnJigsawPiece,
  moveJigsaw,
  rotateJigsaw,
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
