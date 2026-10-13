import { buildPhotoWordSearch, photoSearchLine, matchPhotoSearchLine } from "./photoWordSearch";
import type { PhotoGamePhoto } from "./photoGames";
const photos: PhotoGamePhoto[] = [
  "people",
  "water",
  "food",
  "snow",
  "animals",
  "buildings",
].flatMap((tag) =>
  Array.from({ length: 12 }, (_, i) => ({
    path: `${tag}-${i}`,
    href: "/",
    caption: tag,
    tags: tag,
    vector: [],
  })),
);
it("traces straight lines in either direction without wrapping rows", () => {
  expect(photoSearchLine(0, 12, 5)).toEqual([0, 6, 12]);
  expect(photoSearchLine(12, 0, 5)).toEqual([12, 6, 0]);
  expect(photoSearchLine(4, 5, 5)).toEqual([]);
  expect(photoSearchLine(0, 7, 5)).toEqual([]);
});
it.each([5, 6] as const)(
  "plants four discoverable connections in a unique %s-square board",
  (size) => {
    const puzzle = buildPhotoWordSearch(photos, size, () => 0.37)!;
    expect(puzzle.tiles).toHaveLength(size * size);
    expect(new Set(puzzle.tiles.map((photo) => photo.path)).size).toBe(size * size);
    expect(puzzle.targets).toHaveLength(4);
    for (const target of puzzle.targets) {
      expect(target.cells).toHaveLength(3);
      expect(matchPhotoSearchLine(puzzle, [...target.cells].reverse(), [])?.id).toBe(target.id);
      expect(matchPhotoSearchLine(puzzle, target.cells, [target.id])).toBeNull();
    }
  },
);
it("rejects bent selections and undersized archives", () => {
  const puzzle = buildPhotoWordSearch(photos, 5, () => 0.37)!;
  expect(matchPhotoSearchLine(puzzle, [0, 1, 7], [])).toBeNull();
  expect(buildPhotoWordSearch(photos.slice(0, 8), 5)).toBeNull();
});
