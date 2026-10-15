import { photoLocationDistance as distance } from "./photoLocationDistance";
import { shuffleGamePhotos, type PhotoGamePhoto } from "./photoGames";
import { exifDayKey } from "./exifTime";

export type DoubleTakePair = {
  photos: [PhotoGamePhoto, PhotoGamePhoto];
  samePlace: boolean;
  distanceMetres: number;
  similarity: number;
};

const validLocation = (photo: PhotoGamePhoto) => {
  const point = photo.location;
  return (
    point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180 &&
    !(point.lat === 0 && point.lng === 0) &&
    exifDayKey(point.date)
  );
};

type Candidates = { sameRanked: DoubleTakePair[]; distantSorted: DoubleTakePair[] };
type Comparison = {
  valid: Array<{ photo: PhotoGamePhoto; vector: number[] }>;
  pools: [DoubleTakePair[], DoubleTakePair[]];
  next: number;
  candidates: Candidates | null;
};

// Comparing every located pair is about a million 768-dimension dot products for the whole
// archive — seconds of work — so a collection is compared once, a slice at a time, and each
// new game only draws from the result. A changed collection must be a new array.
const comparisons = new WeakMap<readonly PhotoGamePhoto[], Comparison>();

const comparisonFor = (photos: readonly PhotoGamePhoto[]): Comparison => {
  const existing = comparisons.get(photos);
  if (existing) return existing;
  const valid = [
    ...new Map(photos.filter(validLocation).map((photo) => [photo.path, photo])).values(),
  ].flatMap((photo) => {
    const norm = Math.hypot(...photo.vector);
    return photo.vector.length && Number.isFinite(norm) && norm > 0
      ? [{ photo, vector: Array.from(photo.vector, (v) => v / norm) }]
      : [];
  });
  const comparison: Comparison = { valid, pools: [[], []], next: 0, candidates: null };
  comparisons.set(photos, comparison);
  return comparison;
};

// Nearby means the same small area, rather than proof of the same building.
// Leave a wide gap between classes so borderline GPS readings never decide a round.
const compareRow = ({ valid, pools }: Comparison, i: number) => {
  const a = valid[i]!;
  for (let j = i + 1; j < valid.length; j++) {
    const b = valid[j]!;
    if (a.vector.length !== b.vector.length) continue;
    const metres = distance(a.photo.location!, b.photo.location!);
    const samePlace = metres <= 75;
    if (!samePlace && metres < 5000) continue;
    if (samePlace && exifDayKey(a.photo.location!.date) === exifDayKey(b.photo.location!.date))
      continue;
    let similarity = 0;
    for (let index = 0; index < a.vector.length; index++)
      similarity += a.vector[index]! * b.vector[index]!;
    if (similarity < 0.65 || similarity > 0.995) continue;
    pools[samePlace ? 0 : 1].push({
      photos: [a.photo, b.photo],
      samePlace,
      distanceMetres: metres,
      similarity,
    });
  }
};

/** Compares the collection's photographs for up to `budgetMs` (always at least one photograph),
 * resuming where the last call stopped. Returns true once a deck can be built without more work. */
export const prepareDoubleTakePairs = (
  photos: readonly PhotoGamePhoto[],
  budgetMs = Infinity,
): boolean => {
  const comparison = comparisonFor(photos);
  if (comparison.candidates) return true;
  if (comparison.next < comparison.valid.length) {
    // Ranking the pools is a step of its own, so it never extends a full slice.
    const deadline = performance.now() + budgetMs;
    do compareRow(comparison, comparison.next++);
    while (comparison.next < comparison.valid.length && performance.now() < deadline);
    if (budgetMs !== Infinity) return false;
  }
  const [same, distant] = comparison.pools;
  comparison.candidates = {
    sameRanked: same.sort((a, b) => b.similarity - a.similarity).slice(0, 24),
    distantSorted: distant.sort((a, b) => b.similarity - a.similarity),
  };
  return true;
};

const candidatePairs = (photos: readonly PhotoGamePhoto[]): Candidates => {
  prepareDoubleTakePairs(photos);
  return comparisonFor(photos).candidates!;
};

export const buildDoubleTakeDeck = (
  photos: readonly PhotoGamePhoto[],
  random: () => number = Math.random,
  rounds = 8,
): DoubleTakePair[] => {
  const { sameRanked, distantSorted } = candidatePairs(photos);
  // Half the rounds use the strongest resemblance in each answer class. The
  // other half match resemblance across classes, retaining less obvious return
  // visits without making every very similar pair a distant-place answer.
  const buckets = new Map<number, DoubleTakePair[]>();
  for (const pair of distantSorted) {
    const bucket = Math.floor(pair.similarity * 40);
    const values = buckets.get(bucket) ?? [];
    if (values.length < 80) values.push(pair);
    buckets.set(bucket, values);
  }
  const distantRanked = shuffleGamePhotos([...buckets.values()].flat(), random);
  const used = new Set<string>();
  const deck: DoubleTakePair[] = [];
  const pairedRounds = Math.floor(Math.min(12, rounds) / 2);
  const available = (pair: DoubleTakePair) => pair.photos.every((photo) => !used.has(photo.path));
  const strongest = (ranked: DoubleTakePair[]) => {
    const eligible = ranked.filter(available);
    const best = eligible[0]?.similarity;
    return best === undefined
      ? []
      : shuffleGamePhotos(
          eligible.filter((pair) => pair.similarity >= best - 0.025).slice(0, 8),
          random,
        );
  };
  for (let round = 0; round < pairedRounds; round++) {
    let chosen: [DoubleTakePair, DoubleTakePair] | null = null;
    const strongRound = round < Math.ceil(pairedRounds / 2);
    const sameCandidates = strongRound
      ? strongest(sameRanked)
      : shuffleGamePhotos(sameRanked.filter(available), random);
    for (const same of sameCandidates) {
      const independent: DoubleTakePair[] = [];
      if (strongRound) {
        for (const pair of distantSorted) {
          if (independent[0] && pair.similarity < independent[0].similarity - 0.025) break;
          if (
            available(pair) &&
            pair.photos.every((photo) => !same.photos.some((p) => p.path === photo.path))
          )
            independent.push(pair);
          if (independent.length === 8) break;
        }
      }
      const strongOther = shuffleGamePhotos(independent, random)[0];
      const other = distantRanked
        .filter(
          (pair) =>
            Math.abs(pair.similarity - same.similarity) <= 0.04 &&
            pair.photos.every(
              (photo) => !used.has(photo.path) && !same.photos.some((p) => p.path === photo.path),
            ),
        )
        .sort(
          (a, b) =>
            Math.abs(a.similarity - same.similarity) - Math.abs(b.similarity - same.similarity),
        )[0];
      if (strongOther || other) {
        chosen = [same, (strongOther || other)!];
        break;
      }
    }
    if (!chosen) break;
    for (const pair of chosen) {
      pair.photos.forEach((photo) => used.add(photo.path));
      deck.push({
        ...pair,
        photos: shuffleGamePhotos(pair.photos, random) as DoubleTakePair["photos"],
      });
    }
  }
  return shuffleGamePhotos(deck, random);
};

export const doubleTakePoints = (correct: boolean, streak: number, replayed: boolean) =>
  correct ? 100 + (replayed ? 0 : Math.min(4, Math.max(0, streak)) * 25) : 0;
