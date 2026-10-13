import { buildPhotoWordSearch, photoSearchLine, matchPhotoSearchLine } from "./photoWordSearch";
import type { PhotoGamePhoto } from "./photoGames";
const photos: PhotoGamePhoto[] = ["cat", "bicycle", "boat", "umbrella", "stairs", "clock"].flatMap(
  (tag) =>
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

it("prefers prominent photographic subjects over background mentions and tag-only matches", () => {
  const subjects = ["cat", "bicycle", "boat", "umbrella", "stairs", "clock"];
  const archive = subjects.flatMap((subject) =>
    Array.from({ length: 9 }, (_, index) => ({
      path: `${subject}-${index}`,
      href: "/",
      tags: subject,
      vector: [],
      caption:
        index < 3
          ? `A close-up of a ${subject}.`
          : `A street with a ${subject} barely visible in the background.`,
    })),
  );
  const puzzle = buildPhotoWordSearch(archive, 5, () => 0.37)!;
  for (const target of puzzle.targets)
    expect(target.cells.every((cell) => puzzle.tiles[cell]!.caption.startsWith("A close-up"))).toBe(
      true,
    );
});

it("declines boards whose only topics are broad scenery categories", () => {
  const broad = ["sky", "buildings", "people", "water"].flatMap((subject) =>
    Array.from({ length: 12 }, (_, i) => ({
      path: `${subject}-${i}`,
      href: "/",
      caption: subject,
      tags: subject,
      vector: [],
    })),
  );
  expect(buildPhotoWordSearch(broad)).toBeNull();
});

it("spreads equally clear solution photographs across outings when available", () => {
  const archive = photos.map((photo, index) => ({
    ...photo,
    caption: `A ${photo.tags} photographed from angle ${index}.`,
    location: {
      lat: 1,
      lng: 103,
      date: index % 12 < 6 ? "2026-01-01" : `2026-02-${String(index % 12).padStart(2, "0")}`,
      label: "",
    },
  }));
  const puzzle = buildPhotoWordSearch(archive, 5, () => 0.37)!;
  for (const target of puzzle.targets)
    expect(new Set(target.cells.map((cell) => puzzle.tiles[cell]!.location!.date)).size).toBe(3);
});

it("accepts a truthful alternative line rather than only the planted coordinates", () => {
  const puzzle = buildPhotoWordSearch(photos, 5, () => 0.37)!;
  const target = puzzle.targets[0]!;
  const cells = [0, 1, 2];
  const tiles = [...puzzle.tiles];
  cells.forEach((cell, index) => {
    tiles[cell] = puzzle.tiles[target.cells[index]!]!;
  });
  expect(matchPhotoSearchLine({ ...puzzle, tiles }, cells, [])?.id).toBe(target.id);
});
