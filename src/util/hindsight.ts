import { exifWallClockTimestamp } from "./exifTime";
import { shuffleGamePhotos, type PhotoGamePhoto } from "./photoGames";

export type HindsightSize = 4 | 5 | 6;
export type HindsightSpread = "years" | "trip";
export type HindsightSettings = { size: HindsightSize; spread: HindsightSpread };

/** A dealt photograph with its parsed wall clock. */
export type HindsightPhoto = PhotoGamePhoto & { takenAt: string; time: number };

export type HindsightPuzzle = {
  spread: HindsightSpread;
  /** The photographs as dealt: never already in order. */
  hand: HindsightPhoto[];
  /** Oldest first. */
  solution: HindsightPhoto[];
};

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Two photographs closer than this are a near-tie and never dealt together. */
export const HINDSIGHT_MIN_GAP_MS = 10 * MINUTE;
/** Across the years: every pair at least about three months apart. */
export const HINDSIGHT_YEARS_MIN_GAP_MS = 90 * DAY;
/** One trip: one album, first to last within two weeks. */
export const HINDSIGHT_TRIP_WINDOW_MS = 14 * DAY;

const ATTEMPTS = 24;

/** The album a photograph belongs to: its directory, which is how albums are stored. */
export const hindsightTrip = (photo: Pick<PhotoGamePhoto, "path">): string =>
  photo.path.slice(0, photo.path.lastIndexOf("/") + 1);

// Ordering uses the camera's wall clock, the same clock the reveal shows. The
// zone cancels out within one place; across places the gaps dealt are far
// wider than any difference between zones.
const dated = (photos: readonly PhotoGamePhoto[]): HindsightPhoto[] => {
  const seen = new Set<string>();
  const result: HindsightPhoto[] = [];
  for (const photo of photos) {
    if (seen.has(photo.path) || !photo.takenAt) continue;
    const time = exifWallClockTimestamp(photo.takenAt);
    if (time === null) continue;
    seen.add(photo.path);
    result.push({ ...photo, takenAt: photo.takenAt, time });
  }
  return result;
};

/** Takes photographs in the given order, skipping any too close to one already taken. */
const pickApart = (
  candidates: readonly HindsightPhoto[],
  size: number,
  minGap: number,
): HindsightPhoto[] | null => {
  const chosen: HindsightPhoto[] = [];
  for (const candidate of candidates) {
    if (chosen.every((item) => Math.abs(item.time - candidate.time) >= minGap))
      chosen.push(candidate);
    if (chosen.length === size) return chosen;
  }
  return null;
};

const dealYears = (photos: HindsightPhoto[], size: number, random: () => number) => {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const hand = pickApart(shuffleGamePhotos(photos, random), size, HINDSIGHT_YEARS_MIN_GAP_MS);
    if (hand) return hand;
  }
  return null;
};

const dealTrip = (photos: HindsightPhoto[], size: number, random: () => number) => {
  const trips = new Map<string, HindsightPhoto[]>();
  for (const photo of photos) {
    const trip = hindsightTrip(photo);
    trips.set(trip, [...(trips.get(trip) ?? []), photo]);
  }
  const anchors = shuffleGamePhotos(
    photos.filter((photo) => trips.get(hindsightTrip(photo))!.length >= size),
    random,
  );
  const half = HINDSIGHT_TRIP_WINDOW_MS / 2;
  for (const anchor of anchors.slice(0, ATTEMPTS * 8)) {
    // A window centred on the anchor keeps first to last within two weeks.
    const window = trips
      .get(hindsightTrip(anchor))!
      .filter((photo) => photo !== anchor && Math.abs(photo.time - anchor.time) <= half);
    const hand = pickApart(
      [anchor, ...shuffleGamePhotos(window, random)],
      size,
      HINDSIGHT_MIN_GAP_MS,
    );
    if (hand) return hand;
  }
  return null;
};

export const buildHindsightPuzzle = (
  photos: readonly PhotoGamePhoto[],
  { size, spread }: HindsightSettings,
  random: () => number = Math.random,
): HindsightPuzzle | null => {
  const candidates = dated(photos);
  if (candidates.length < size) return null;
  const hand =
    spread === "years" ? dealYears(candidates, size, random) : dealTrip(candidates, size, random);
  if (!hand) return null;
  const solution = [...hand].sort((a, b) => a.time - b.time);
  const dealt = shuffleGamePhotos(hand, random);
  // A hand dealt in order would be solved before it started.
  if (dealt.every((item, index) => item === solution[index])) dealt.push(dealt.shift()!);
  return { spread, hand: dealt, solution };
};

export type HindsightScore = {
  /** Every pair of photographs: n(n−1)/2. */
  pairs: number;
  /** Pairs the player put the right way round. */
  inOrder: number;
  /** Photographs in exactly the right position. */
  inPlace: number;
  /** Share of pairs in order, 0–100. */
  score: number;
  perfect: boolean;
};

/**
 * Kendall-tau style: the share of all pairs the player put the right way round.
 * One photograph out of place costs only the pairs it breaks, where counting
 * exact positions would punish a single early slip along the whole row.
 */
export const scoreHindsight = (
  solution: readonly HindsightPhoto[],
  order: readonly HindsightPhoto[],
): HindsightScore => {
  const rank = new Map(solution.map((photo, index) => [photo.path, index]));
  let pairs = 0;
  let inOrder = 0;
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++) {
      pairs++;
      if (rank.get(order[i]!.path)! < rank.get(order[j]!.path)!) inOrder++;
    }
  const inPlace = order.filter((photo, index) => photo.path === solution[index]?.path).length;
  return {
    pairs,
    inOrder,
    inPlace,
    score: pairs ? Math.round((inOrder / pairs) * 100) : 0,
    perfect: pairs > 0 && inOrder === pairs,
  };
};

const unit = (count: number, name: string) => `${count} ${name}${count === 1 ? "" : "s"} later`;

/** The time between neighbouring photographs, in the largest whole unit. */
export const formatHindsightGap = (ms: number): string => {
  if (ms < 3_600_000) return unit(Math.floor(ms / MINUTE), "minute");
  if (ms < DAY) return unit(Math.floor(ms / 3_600_000), "hour");
  if (ms < 30 * DAY) return unit(Math.floor(ms / DAY), "day");
  if (ms < 365 * DAY) return unit(Math.floor(ms / (30.44 * DAY)), "month");
  return unit(Math.floor(ms / (365.25 * DAY)), "year");
};
