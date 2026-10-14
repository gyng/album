import { buildDoubleTakeDeck, doubleTakePoints, prepareDoubleTakePairs } from "./doubleTake";
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

it("includes the strongest distant lookalikes alongside comparable pairs, without reusing photographs", () => {
  const specifications = [
    [true, 0.88],
    [true, 0.87],
    [true, 0.76],
    [true, 0.75],
    [false, 0.95],
    [false, 0.94],
    [false, 0.88],
    [false, 0.87],
    [false, 0.76],
    [false, 0.75],
  ] as const;
  const photos = specifications.flatMap(([same, similarity], pair) => {
    const first = Array<number>(specifications.length * 2).fill(0);
    const second = [...first];
    first[pair * 2] = 1;
    second[pair * 2] = similarity;
    second[pair * 2 + 1] = Math.sqrt(1 - similarity ** 2);
    return [
      photo(`pair-${pair}-a`, 10 + pair, 30, "2024-01-01", first),
      photo(`pair-${pair}-b`, 10 + pair + (same ? 0.0001 : 0.1), 30, "2024-02-01", second),
    ];
  });
  const deck = buildDoubleTakeDeck(photos, () => 0.4);
  expect(deck).toHaveLength(8);
  const same = deck.filter((pair) => pair.samePlace);
  const distant = deck.filter((pair) => !pair.samePlace);
  expect(same).toHaveLength(4);
  expect(distant.filter((pair) => pair.similarity > 0.93)).toHaveLength(2);
  expect(distant.filter((pair) => pair.similarity < 0.8)).toHaveLength(2);
  expect(new Set(deck.flatMap((pair) => pair.photos.map((photo) => photo.path))).size).toBe(16);
});

it("prepares the candidate pairs once per collection, so another game only draws a new deck", () => {
  let reads = 0;
  const photos = Array.from({ length: 8 }, (_, i) => {
    const value = photo(String(i), i < 4 ? 35 : 45, i % 2 ? 139.0001 : 139, `2024-01-0${i + 1}`);
    const { vector } = value;
    return Object.defineProperty(value, "vector", {
      get: () => {
        reads++;
        return vector;
      },
    });
  });
  const first = buildDoubleTakeDeck(photos, () => 0.4, 4);
  expect(reads).toBeGreaterThan(0);
  reads = 0;
  expect(buildDoubleTakeDeck(photos, () => 0.4, 4)).toEqual(first);
  expect(reads).toBe(0);
  expect(buildDoubleTakeDeck([...photos], () => 0.4, 4)).toEqual(first);
  expect(reads).toBeGreaterThan(0);
});

it("compares a collection in resumable slices that yield the same deck as one pass", () => {
  const photos = Array.from({ length: 8 }, (_, i) =>
    photo(String(i), i < 4 ? 35 : 45, i % 2 ? 139.0001 : 139, `2024-01-0${i + 1}`),
  );
  let slices = 1;
  while (!prepareDoubleTakePairs(photos, 0)) slices++;
  expect(slices).toBeGreaterThan(1);
  expect(prepareDoubleTakePairs(photos, 0)).toBe(true);
  expect(buildDoubleTakeDeck(photos, () => 0.4, 4)).toEqual(
    buildDoubleTakeDeck([...photos], () => 0.4, 4),
  );
});

it("awards correctness first and removes the streak bonus after a replay", () => {
  expect(doubleTakePoints(false, 4, false)).toBe(0);
  expect(doubleTakePoints(true, 4, true)).toBe(100);
  expect(doubleTakePoints(true, 4, false)).toBeGreaterThan(100);
});
