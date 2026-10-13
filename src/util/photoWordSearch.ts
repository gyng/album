import {
  ORACLE_QUESTIONS,
  shuffleGamePhotos,
  type OracleQuestion,
  type PhotoGamePhoto,
} from "./photoGames";
import { crosswordClue } from "./photoCrossword";

export type PhotoSearchTarget = {
  id: string;
  label: string;
  cells: number[];
  matches: OracleQuestion["matches"];
};
export type PhotoWordSearch = {
  size: 5 | 6;
  tiles: PhotoGamePhoto[];
  targets: PhotoSearchTarget[];
};

export const photoSearchLine = (start: number, end: number, size: number): number[] => {
  if (![start, end].every((index) => Number.isInteger(index) && index >= 0 && index < size * size))
    return [];
  const row = Math.floor(start / size),
    column = start % size;
  const dy = Math.floor(end / size) - row,
    dx = (end % size) - column;
  if (dy && dx && Math.abs(dy) !== Math.abs(dx)) return [];
  return Array.from(
    { length: Math.max(Math.abs(dy), Math.abs(dx)) + 1 },
    (_, i) => (row + Math.sign(dy) * i) * size + column + Math.sign(dx) * i,
  );
};

export const matchPhotoSearchLine = (
  puzzle: PhotoWordSearch,
  cells: number[],
  found: string[],
): PhotoSearchTarget | null => {
  if (
    cells.length !== 3 ||
    photoSearchLine(cells[0]!, cells[2]!, puzzle.size).join() !== cells.join()
  )
    return null;
  // Accept any valid run, including accidental ones: metadata cannot justify rejecting it.
  return (
    puzzle.targets.find(
      (target) =>
        !found.includes(target.id) && cells.every((index) => target.matches(puzzle.tiles[index]!)),
    ) ?? null
  );
};

export const buildPhotoWordSearch = (
  photos: PhotoGamePhoto[],
  size: 5 | 6 = 5,
  random: () => number = Math.random,
): PhotoWordSearch | null => {
  const unique = [...new Map(photos.map((photo) => [photo.path, photo])).values()];
  if (unique.length < size * size) return null;
  const subjects = shuffleGamePhotos(
    ORACLE_QUESTIONS.filter((q) => unique.filter(q.matches).length >= 3),
    random,
  );
  const lines: number[][] = [];
  for (let start = 0; start < size * size; start++) {
    for (const [dy, dx] of [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ]) {
      const row = Math.floor(start / size) + dy! * 2,
        column = (start % size) + dx! * 2;
      if (row >= 0 && row < size && column >= 0 && column < size)
        lines.push(photoSearchLine(start, row * size + column, size));
    }
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const used = new Set<string>();
    const tiles: Array<PhotoGamePhoto | undefined> = Array(size * size);
    const targets: PhotoSearchTarget[] = [];
    for (const subject of shuffleGamePhotos(subjects, random)) {
      const pool = shuffleGamePhotos(
        unique.filter((photo) => !used.has(photo.path) && subject.matches(photo)),
        random,
      );
      const line = shuffleGamePhotos(lines, random).find((cells) =>
        cells.every((cell) => !tiles[cell]),
      );
      if (pool.length < 3 || !line) continue;
      line.forEach((cell, i) => {
        tiles[cell] = pool[i]!;
        used.add(pool[i]!.path);
      });
      targets.push({
        id: subject.id,
        label: crosswordClue(subject),
        cells: line,
        matches: subject.matches,
      });
      if (targets.length === 4) break;
    }
    if (targets.length < 4) continue;
    const filler = shuffleGamePhotos(
      unique.filter((photo) => !used.has(photo.path)),
      random,
    );
    let next = 0;
    return { size, tiles: Array.from(tiles, (photo) => photo ?? filler[next++]!), targets };
  }
  return null;
};
