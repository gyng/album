import { shuffleGamePhotos } from "./photoGames";
export type JigsawMode = "pool" | "swap" | "rotate" | "slide";
export type JigsawState = { tiles: number[]; turns: number[]; moves: number; pool?: number[] };
export const jigsawSolved = (state: JigsawState): boolean =>
  state.tiles.length > 0 &&
  (!state.pool || state.pool.length === 0) &&
  state.tiles.every(
    (tile, i) =>
      (tile === i || (!state.pool && tile === -1 && i === state.tiles.length - 1)) &&
      state.turns[i] === 0,
  );

/** Move a piece from the pool or another cell; an occupied destination exchanges pieces. */
export const placeJigsawPiece = (
  state: JigsawState,
  piece: number,
  target: number,
): JigsawState => {
  if (
    !state.pool ||
    !Number.isInteger(piece) ||
    piece < 0 ||
    !Number.isInteger(target) ||
    state.tiles[target] === undefined ||
    state.tiles[target] === piece
  )
    return state;
  const source = state.tiles.indexOf(piece);
  if (source < 0 && !state.pool.includes(piece)) return state;
  const tiles = [...state.tiles];
  const displaced = tiles[target]!;
  let pool = [...state.pool];
  if (source >= 0) tiles[source] = displaced;
  else {
    pool = pool.filter((value) => value !== piece);
    if (displaced >= 0) pool.push(displaced);
  }
  tiles[target] = piece;
  return { ...state, tiles, pool, moves: state.moves + 1 };
};

export const returnJigsawPiece = (state: JigsawState, piece: number): JigsawState => {
  const source = state.tiles.indexOf(piece);
  if (!state.pool || piece < 0 || source < 0) return state;
  return {
    ...state,
    tiles: state.tiles.map((tile, i) => (i === source ? -1 : tile)),
    pool: [...state.pool, piece],
    moves: state.moves + 1,
  };
};
const neighbours = (a: number, b: number, size: number) =>
  Math.abs(Math.floor(a / size) - Math.floor(b / size)) + Math.abs((a % size) - (b % size)) === 1;
export const moveJigsaw = (
  state: JigsawState,
  first: number,
  second: number,
  mode: JigsawMode,
  size: number,
): JigsawState => {
  if (first === second || state.tiles[first] === undefined || state.tiles[second] === undefined)
    return state;
  if (
    mode === "slide" &&
    (!neighbours(first, second, size) || (state.tiles[first] !== -1 && state.tiles[second] !== -1))
  )
    return state;
  const tiles = [...state.tiles],
    turns = [...state.turns];
  [tiles[first], tiles[second]] = [tiles[second]!, tiles[first]!];
  [turns[first], turns[second]] = [turns[second]!, turns[first]!];
  return { tiles, turns, moves: state.moves + 1 };
};
export const rotateJigsaw = (state: JigsawState, index: number): JigsawState =>
  state.tiles[index] === undefined || state.tiles[index]! < 0
    ? state
    : {
        ...state,
        moves: state.moves + 1,
        turns: state.turns.map((v, i) => (i === index ? (v + 1) % 4 : v)),
      };
export const dealJigsaw = (size: number, mode: JigsawMode, random = Math.random): JigsawState => {
  if (size !== 3 && size !== 4 && size !== 5) throw new Error("Unsupported jigsaw size");
  let state: JigsawState = {
    tiles: Array.from({ length: size * size }, (_, i) => i),
    turns: Array<number>(size * size).fill(0),
    moves: 0,
  };
  if (mode === "pool")
    return {
      ...state,
      tiles: Array<number>(size * size).fill(-1),
      pool: shuffleGamePhotos(state.tiles, random),
    };
  if (mode === "slide") {
    state.tiles[state.tiles.length - 1] = -1;
    let previous = -1;
    for (let step = 0; step < size * size * 30; step++) {
      const empty = state.tiles.indexOf(-1);
      const options = state.tiles
        .map((_, i) => i)
        .filter((i) => i !== previous && neighbours(i, empty, size));
      const next =
        options[Math.min(options.length - 1, Math.max(0, Math.floor(random() * options.length)))]!;
      state = moveJigsaw(state, next, empty, mode, size);
      previous = empty;
    }
    if (jigsawSolved(state)) {
      const empty = state.tiles.indexOf(-1);
      state = moveJigsaw(state, empty - 1, empty, mode, size);
    }
  } else {
    state.tiles = shuffleGamePhotos(state.tiles, random);
    if (mode === "rotate")
      state.turns = state.turns.map(() => Math.min(3, Math.max(0, Math.floor(random() * 4))));
    if (jigsawSolved(state)) [state.tiles[0], state.tiles[1]] = [state.tiles[1]!, state.tiles[0]!];
  }
  return { ...state, moves: 0 };
};
