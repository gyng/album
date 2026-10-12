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

const distance = (
  a: NonNullable<PhotoGamePhoto["location"]>,
  b: NonNullable<PhotoGamePhoto["location"]>,
) => {
  const radians = Math.PI / 180;
  const value =
    Math.sin(((b.lat - a.lat) * radians) / 2) ** 2 +
    Math.cos(a.lat * radians) *
      Math.cos(b.lat * radians) *
      Math.sin(((b.lng - a.lng) * radians) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
};

// Nearby means the same small area, rather than proof of the same building.
// Leave a wide gap between classes so borderline GPS readings never decide a round.
export const buildDoubleTakeDeck = (
  photos: PhotoGamePhoto[],
  random: () => number = Math.random,
  rounds = 8,
): DoubleTakePair[] => {
  const valid = [
    ...new Map(photos.filter(validLocation).map((photo) => [photo.path, photo])).values(),
  ].flatMap((photo) => {
    const norm = Math.hypot(...photo.vector);
    return photo.vector.length && Number.isFinite(norm) && norm > 0
      ? [{ photo, vector: Array.from(photo.vector, (v) => v / norm) }]
      : [];
  });
  const pools: [DoubleTakePair[], DoubleTakePair[]] = [[], []];
  for (let i = 0; i < valid.length; i++) {
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
  }
  // Rank both answers by visual resemblance, then sample from their strongest
  // candidates. Round order and photo order disclose neither answer nor class.
  const sameRanked = shuffleGamePhotos(
    pools[0].sort((a, b) => b.similarity - a.similarity).slice(0, 48),
    random,
  );
  // Keep strong candidates throughout the resemblance range. Taking only the
  // strongest distant pairs would make resemblance itself disclose the answer.
  const buckets = new Map<number, DoubleTakePair[]>();
  for (const pair of pools[1].sort((a, b) => b.similarity - a.similarity)) {
    const bucket = Math.floor(pair.similarity * 40);
    const values = buckets.get(bucket) ?? [];
    if (values.length < 80) values.push(pair);
    buckets.set(bucket, values);
  }
  const distantRanked = shuffleGamePhotos([...buckets.values()].flat(), random);
  const used = new Set<string>();
  const deck: DoubleTakePair[] = [];
  for (let round = 0; round < Math.min(12, rounds); round += 2) {
    let chosen: [DoubleTakePair, DoubleTakePair] | null = null;
    for (const same of sameRanked) {
      if (same.photos.some((photo) => used.has(photo.path))) continue;
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
      if (other) {
        chosen = [same, other];
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
