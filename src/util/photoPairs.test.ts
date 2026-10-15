import {
  buildPhotoPairs,
  flipPairCard,
  initialPairsState,
  shuffleUnmatched,
  type PairCard,
} from "./photoPairs";
import type { PhotoGamePhoto } from "./photoGames";
const photos: PhotoGamePhoto[] = Array.from({ length: 12 }, (_, i) => ({
  path: `p${i}`,
  href: `/p${i}`,
  caption: i < 6 ? "A dog portrait" : "A train",
  tags: i < 6 ? "dog" : "train",
  vector: Array.from({ length: 6 }, (_, axis) => (axis === Math.floor(i / 2) ? 1 : 0)),
}));
it("deals distinct photographs in pairs without duplicate paths", () => {
  const cards = buildPhotoPairs(photos, 4, "visual", () => 0.3)!;
  expect(cards).toHaveLength(8);
  expect(new Set(cards.map((c) => c.photo.path)).size).toBe(8);
  for (const id of new Set(cards.map((c) => c.pair)))
    expect(cards.filter((c) => c.pair === id)).toHaveLength(2);
  for (const card of cards) {
    const partner = cards.find((other) => other !== card && other.pair === card.pair)!;
    const dot = (a: PhotoGamePhoto, b: PhotoGamePhoto) =>
      Array.from(a.vector).reduce((sum, v, i) => sum + v * b.vector[i]!, 0);
    expect(
      cards
        .filter((other) => other.pair !== card.pair)
        .every((other) => dot(card.photo, partner.photo) > dot(card.photo, other.photo)),
    ).toBe(true);
  }
});

it("moves only unmatched cards without changing their pair identities", () => {
  const cards = photos.slice(0, 8).map((photo, i) => ({ photo, pair: Math.floor(i / 2) }));
  const shuffled = shuffleUnmatched(cards, [0, 1], () => 0);
  expect(shuffled.slice(0, 2)).toEqual(cards.slice(0, 2));
  expect(shuffled.slice(2)).not.toEqual(cards.slice(2));
  expect(new Set(shuffled)).toEqual(new Set(cards));
  expect(shuffleUnmatched(cards, [0, 1], () => 0.999).slice(2)).not.toEqual(cards.slice(2));
});
it("semantic pairs have a shared concrete subject and choose a separate subject per pair", () => {
  const cards = buildPhotoPairs(photos, 2, "semantic", () => 0.3)!;
  expect(new Set(cards.map((c) => c.subject))).toEqual(new Set(["DOG", "TRAIN"]));
  expect(buildPhotoPairs(photos, 4, "semantic", () => 0.3)).toBeNull();
});
it("rejects invalid vectors and repeated source paths", () => {
  expect(
    buildPhotoPairs([{ ...photos[0]!, vector: [NaN] }, photos[0]!, photos[0]!], 2, "visual"),
  ).toBeNull();
});
it("matches only two different cards, blocks a third flip and settles misses explicitly", () => {
  const cards = [0, 1, 0, 1].map((pair, i) => ({ pair, photo: photos[i]! })) as PairCard[];
  let s = initialPairsState();
  s = flipPairCard(s, 0, cards);
  expect(flipPairCard(s, 0, cards)).toBe(s);
  s = flipPairCard(s, 1, cards);
  expect(s.turns).toBe(1);
  expect(flipPairCard(s, 2, cards)).toBe(s);
  s = { ...s, open: [] };
  s = flipPairCard(flipPairCard(s, 0, cards), 2, cards);
  expect(s.matched).toEqual([0, 2]);
  expect(s.open).toEqual([]);
  expect(s.turns).toBe(2);
  expect(flipPairCard(s, 0, cards)).toBe(s);
});

it.each([12, 18, 24])("deals %i unambiguous pairs for larger boards", (count) => {
  const source = Array.from({ length: count * 2 }, (_, i) => ({
    ...photos[0]!,
    path: `large-${i}`,
    vector: Array.from({ length: count }, (_, axis) => (axis === Math.floor(i / 2) ? 1 : 0)),
  }));
  const cards = buildPhotoPairs(source, count, "visual", () => 0.3)!;
  expect(cards).toHaveLength(count * 2);
  expect(new Set(cards.map((card) => card.photo.path)).size).toBe(count * 2);
  for (const pair of new Set(cards.map((card) => card.pair)))
    expect(cards.filter((card) => card.pair === pair)).toHaveLength(2);
});
