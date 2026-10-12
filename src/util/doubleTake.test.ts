import { buildDoubleTakeDeck, doubleTakePoints } from "./doubleTake";
import type { PhotoGamePhoto } from "./photoGames";

const photo = (
  path: string,
  lat: number,
  lng: number,
  day: string,
  vector = [1, ((Number(path) || 0) % 2) * 0.3],
): PhotoGamePhoto => ({
  path,
  href: path,
  caption: "A street",
  tags: "",
  vector,
  location: { lat, lng, date: `${day}T12:00:00`, label: "Town" },
});

it("balances nearby return visits with visually similar distant places without reusing photos", () => {
  const photos = Array.from({ length: 8 }, (_, i) =>
    photo(String(i), i < 4 ? 35 : 45, i % 2 ? 139.0001 : 139, `2024-01-0${i + 1}`),
  );
  const deck = buildDoubleTakeDeck(photos, () => 0.4, 4);
  expect(deck).toHaveLength(4);
  expect(deck.filter((p) => p.samePlace)).toHaveLength(2);
  expect(new Set(deck.flatMap((p) => p.photos.map((photo) => photo.path))).size).toBe(8);
  expect(deck.every((p) => (p.samePlace ? p.distanceMetres <= 75 : p.distanceMetres >= 5000))).toBe(
    true,
  );
});

it("excludes ambiguous distances, same-day bursts, invalid coordinates and dissimilar images", () => {
  const first = photo("a", 35, 139, "2024-01-01");
  expect(buildDoubleTakeDeck([first, photo("b", 35.004, 139, "2024-01-02")])).toEqual([]);
  expect(buildDoubleTakeDeck([first, photo("b", 35, 139, "2024-01-01")])).toEqual([]);
  expect(buildDoubleTakeDeck([first, photo("b", NaN, 139, "2024-01-02")])).toEqual([]);
  expect(buildDoubleTakeDeck([first, photo("b", 45, 139, "2024-01-02", [0, 1])])).toEqual([]);
});

it("does not pretend a one-sided archive can produce a balanced game", () => {
  expect(
    buildDoubleTakeDeck(
      Array.from({ length: 8 }, (_, i) => photo(String(i), 35, 139, `2024-01-0${i + 1}`)),
    ),
  ).toEqual([]);
});

it("awards correctness first and removes the streak bonus after a replay", () => {
  expect(doubleTakePoints(false, 4, false)).toBe(0);
  expect(doubleTakePoints(true, 4, true)).toBe(100);
  expect(doubleTakePoints(true, 4, false)).toBeGreaterThan(100);
});
