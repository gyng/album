import { shuffleGamePhotos, type OracleQuestion, type PhotoGamePhoto } from "./photoGames";
import { PHOTO_SUBJECTS, photoSubjectClarity } from "./photoSubjects";

export type PhotoSearchSize = 5 | 6 | 7 | 8 | 9 | 10;
export type PhotoSearchLineLength = 3 | 4 | 5;
export const PHOTO_SEARCH_SIZES = [5, 6, 7, 8, 9, 10] as const;
export const PHOTO_SEARCH_LINE_LENGTHS = [3, 4, 5] as const;

export type PhotoSearchTarget = {
  id: string;
  label: string;
  cells: number[];
  matches: OracleQuestion["matches"];
};
export type PhotoWordSearch = {
  size: PhotoSearchSize;
  lineLength: PhotoSearchLineLength;
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
    cells.length !== puzzle.lineLength ||
    photoSearchLine(cells[0]!, cells.at(-1)!, puzzle.size).join() !== cells.join()
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

/**
 * Takes photographs in the order that stably re-sorting the queue by |memberships − wanted| before
 * every take would give, without the repeated sorts. A run of stable sorts orders a queue by the
 * latest key, then the one before it, and so on, then by its original order; each key here
 * depends only on a photograph's membership count, so every count keeps a queue of its own and a
 * take compares only their heads.
 */
type FillerQueue = { head: number; items: Array<{ photo: PhotoGamePhoto; index: number }> };

const precedes = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
};

const membershipQueue = (
  photos: PhotoGamePhoto[],
  memberships: (photo: PhotoGamePhoto) => number,
) => {
  const queues = new Map<number, FillerQueue>();
  photos.forEach((photo, index) => {
    const count = memberships(photo);
    const queue = queues.get(count) ?? { head: 0, items: [] };
    queue.items.push({ photo, index });
    queues.set(count, queue);
  });
  // Distinct keys, latest first: sorting again by an earlier key adds nothing to the order.
  let recent: number[] = [];
  return (wanted: number): PhotoGamePhoto | undefined => {
    recent = [wanted, ...recent.filter((value) => value !== wanted)];
    let chosen: FillerQueue | null = null;
    let chosenKey: number[] = [];
    for (const [count, queue] of queues) {
      const head = queue.items[queue.head];
      if (!head) continue;
      const key = [...recent.map((value) => Math.abs(count - value)), head.index];
      if (!chosen || precedes(key, chosenKey)) {
        chosen = queue;
        chosenKey = key;
      }
    }
    return chosen ? chosen.items[chosen.head++]!.photo : undefined;
  };
};

export const buildPhotoWordSearch = (
  photos: PhotoGamePhoto[],
  size: PhotoSearchSize = 5,
  random: () => number = Math.random,
  lineLength: PhotoSearchLineLength = 3,
): PhotoWordSearch | null => {
  const unique = [...new Map(photos.map((photo) => [photo.path, photo])).values()];
  if (unique.length < size * size) return null;
  // Strong caption mentions supply solutions; weaker matches can still be accepted as alternatives.
  const subjects = PHOTO_SUBJECTS.flatMap(({ answer, pattern }) => {
    const clarityByPhoto = new Map(
      unique.map((photo) => [photo, photoSubjectClarity(photo, pattern)]),
    );
    const pool = unique.flatMap((photo) => {
      const clarity = clarityByPhoto.get(photo)!;
      return clarity !== null && clarity >= 2 ? [{ photo, clarity }] : [];
    });
    if (pool.length < lineLength) return [];
    const noun = answer.toLowerCase();
    const label =
      (
        {
          stairs: "Stairs",
          bus: "Buses",
          church: "Churches",
          bench: "Benches",
          deer: "Deer",
        } as Record<string, string>
      )[noun] ?? noun[0]!.toUpperCase() + noun.slice(1) + "s";
    return [
      {
        id: noun,
        label,
        pattern,
        pool,
        matches: (photo: PhotoGamePhoto) =>
          (clarityByPhoto.has(photo)
            ? clarityByPhoto.get(photo)
            : photoSubjectClarity(photo, pattern)) !== null,
      },
    ];
  });
  if (subjects.length < 4) return null;
  const targetCount = Math.min(subjects.length, Math.max(4, size - 2));
  const lines: number[][] = [];
  for (let start = 0; start < size * size; start++) {
    for (const [dy, dx] of [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ]) {
      const row = Math.floor(start / size) + dy! * (lineLength - 1),
        column = (start % size) + dx! * (lineLength - 1);
      if (row >= 0 && row < size && column >= 0 && column < size)
        lines.push(photoSearchLine(start, row * size + column, size));
    }
  }
  let best: PhotoWordSearch | null = null;
  let bestPenalty = Infinity;
  for (let attempt = 0; attempt < 16; attempt++) {
    const used = new Set<string>();
    const tiles: Array<PhotoGamePhoto | undefined> = Array(size * size);
    const targets: PhotoSearchTarget[] = [];
    for (const subject of shuffleGamePhotos(subjects, random)) {
      // Related labels should not make the same collection of photographs count twice.
      const overlaps = targets.some((target) => {
        const shared = subject.pool.filter(({ photo }) => target.matches(photo)).length;
        const other = subjects.find((item) => item.id === target.id)!;
        return shared / Math.min(subject.pool.length, other.pool.length) > 0.6;
      });
      if (overlaps) continue;
      const pool = shuffleGamePhotos(
        subject.pool.filter(({ photo }) => !used.has(photo.path)),
        random,
      );
      const line = shuffleGamePhotos(lines, random).find((cells) =>
        cells.every((cell) => !tiles[cell]),
      );
      if (pool.length < lineLength || !line) continue;
      const selected: PhotoGamePhoto[] = [];
      for (const cell of line) {
        const ranked = pool
          .filter(({ photo }) => !used.has(photo.path))
          .sort((a, b) => {
            const score = (item: typeof a) =>
              item.clarity * 4 -
              selected.reduce((penalty, previous) => {
                const sameOuting =
                  item.photo.location &&
                  previous.location &&
                  item.photo.location.date.slice(0, 10) === previous.location.date.slice(0, 10) &&
                  Math.abs(item.photo.location.lat - previous.location.lat) < 0.01 &&
                  Math.abs(item.photo.location.lng - previous.location.lng) < 0.01;
                return (
                  penalty + (sameOuting ? 6 : 0) + (item.photo.caption === previous.caption ? 1 : 0)
                );
              }, 0);
            return score(b) - score(a);
          });
        const photo = ranked[0]!.photo;
        tiles[cell] = photo;
        selected.push(photo);
        used.add(photo.path);
      }
      targets.push({ id: subject.id, label: subject.label, cells: line, matches: subject.matches });
      if (targets.length === targetCount) break;
    }
    if (targets.length < targetCount) continue;
    const filler = shuffleGamePhotos(
      unique.filter((photo) => !used.has(photo.path)),
      random,
    );
    const membershipCounts = new Map(
      unique.map((photo) => [photo, targets.filter((target) => target.matches(photo)).length]),
    );
    const memberships = (photo: PhotoGamePhoto) => membershipCounts.get(photo)!;
    const takeFiller = membershipQueue(filler, memberships);
    // A few single-topic distractors make searching worthwhile; unrelated photos provide breathing room.
    let fillIndex = 0;
    for (let cell = 0; cell < tiles.length; cell++) {
      if (tiles[cell]) continue;
      const wanted = fillIndex++ % 4 === 0 ? 1 : 0;
      tiles[cell] = takeFiller(wanted)!;
    }
    const board = tiles as PhotoGamePhoto[];
    let penalty = 0;
    for (const target of targets) {
      const matches = board.filter(target.matches).length;
      const runs = lines.filter((cells) =>
        cells.every((cell) => target.matches(board[cell]!)),
      ).length;
      penalty += Math.max(0, matches - (lineLength + 2)) * 2 + Math.max(0, runs - 1) * 4;
    }
    penalty += board.filter((photo) => memberships(photo) > 1).length * 2;
    if (penalty < bestPenalty) {
      best = { size, lineLength, tiles: board, targets };
      bestPenalty = penalty;
    }
    if (!penalty) break;
  }
  return best;
};
