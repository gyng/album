import { RandomPhotoRow } from "../components/search/api";
import { extractDateFromExifString } from "./extractExifFromDb";

// Prevent the same photo showing twice in a row when one shuffled queue/pass
// hands off to the next: if the new head repeats the previous pass's last
// path, swap it with the first photo that differs. Mutates the array in place
// (callers always pass a freshly-built array) and returns it for chaining.
export const avoidBoundaryRepeat = (
  photos: RandomPhotoRow[],
  previousLastPath?: string,
): RandomPhotoRow[] => {
  if (
    previousLastPath &&
    photos.length > 1 &&
    photos[0]?.path === previousLastPath
  ) {
    const swapIdx = photos.findIndex(
      (photo) => photo.path !== previousLastPath,
    );
    if (swapIdx > 0) {
      [photos[0], photos[swapIdx]] = [photos[swapIdx], photos[0]];
    }
  }

  return photos;
};

export const shufflePhotos = (
  photos: RandomPhotoRow[],
  previousLastPath?: string,
): RandomPhotoRow[] => {
  const shuffled = [...photos];

  for (let idx = shuffled.length - 1; idx > 0; idx -= 1) {
    const randomIdx = Math.floor(Math.random() * (idx + 1));
    [shuffled[idx], shuffled[randomIdx]] = [shuffled[randomIdx], shuffled[idx]];
  }

  return avoidBoundaryRepeat(shuffled, previousLastPath);
};

export const weightedShufflePhotos = (
  photos: RandomPhotoRow[],
  previousLastPath?: string,
): RandomPhotoRow[] => {
  // Single pass: cache each photo's timestamp (so extractDateFromExifString
  // runs once per photo, not twice) and track min/max with a reduce-style
  // loop. A previous version spread the timestamp array into Math.min/max,
  // which overflows the call stack on very large pools (>~100k photos).
  let minTimestamp = Infinity;
  let maxTimestamp = -Infinity;
  const stamped = photos.map((photo) => {
    const timestamp = extractDateFromExifString(photo.exif)?.getTime() ?? null;
    if (timestamp !== null) {
      if (timestamp < minTimestamp) minTimestamp = timestamp;
      if (timestamp > maxTimestamp) maxTimestamp = timestamp;
    }
    return { photo, timestamp };
  });

  if (minTimestamp === Infinity) {
    return shufflePhotos(photos, previousLastPath);
  }

  const timestampRange = Math.max(1, maxTimestamp - minTimestamp);

  const weighted = stamped
    .map(({ photo, timestamp }) => {
      const normalized =
        timestamp === null
          ? 0.15
          : (timestamp - minTimestamp) / timestampRange;
      const weight = 1 + normalized * 5;
      const randomValue = Math.max(Math.random(), Number.EPSILON);
      return {
        photo,
        key: -Math.log(randomValue) / weight,
      };
    })
    .sort((left, right) => left.key - right.key)
    .map((entry) => entry.photo);

  return avoidBoundaryRepeat(weighted, previousLastPath);
};

export type PoolStats = { count: number; newestDate: Date | null };

export const EMPTY_POOL_STATS: PoolStats = { count: 0, newestDate: null };

export const computePoolStats = (photos: RandomPhotoRow[]): PoolStats => {
  let newest: Date | null = null;
  for (const photo of photos) {
    const date = extractDateFromExifString(photo.exif);
    if (date && (newest === null || date.getTime() > newest.getTime())) {
      newest = date;
    }
  }
  return { count: photos.length, newestDate: newest };
};

export const formatNewestPhotoDate = (date: Date): string =>
  date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export const getSlideshowPhotoSrc = (
  photo: RandomPhotoRow | null,
): string | null => {
  if (!photo?.path) {
    return null;
  }

  const albumName = photo.path.split("/")?.[2] ?? "";
  const photoName = photo.path.split("/")?.[3] ?? "";
  if (!albumName || !photoName) {
    return null;
  }

  return `/data/albums/${albumName}/.resized_images/${photoName}@3200.avif`;
};

// --- Random/weighted queue state machine ---------------------------------
//
// The slideshow draws from a shuffled queue over the photo pool. The same
// state is consulted by two callers that MUST agree: the forward advance
// (which consumes a photo) and the preload buffer (which peeks the upcoming
// photo to warm its decode). A prior implementation rebuilt a throwaway
// shuffle inside the peek, so at a queue boundary the preloaded photo was a
// different one than the advance went on to show — a guaranteed buffer miss
// every queue wrap. Routing both through this shared, stored state fixes that:
// the peek builds the next queue once and stores it, and the advance consumes
// the very photo that was peeked.

export type QueueBuilder = (
  pool: RandomPhotoRow[],
  lastPath?: string,
) => RandomPhotoRow[];

export type RandomQueueState = {
  queue: RandomPhotoRow[];
  index: number;
  lastPath?: string;
};

export const createRandomQueueState = (): RandomQueueState => ({
  queue: [],
  index: -1,
});

// Reset the current queue/position so the next peek/advance rebuilds, while
// preserving lastPath so boundary-repeat avoidance still applies across the
// rebuild (mode/time-aware toggles want this; a full pool swap should make a
// fresh state instead).
export const resetRandomQueue = (state: RandomQueueState): void => {
  state.queue = [];
  state.index = -1;
};

// Return the upcoming photo WITHOUT consuming it, building (and storing) a
// fresh queue at a boundary so repeated peeks — and the subsequent advance —
// all see the same photo.
export const peekNextQueued = (
  state: RandomQueueState,
  pool: RandomPhotoRow[],
  build: QueueBuilder,
): RandomPhotoRow | null => {
  if (pool.length === 0) {
    return null;
  }
  if (state.queue.length === 0 || state.index + 1 >= state.queue.length) {
    state.queue = build(pool, state.lastPath);
    state.index = -1;
  }
  return state.queue[state.index + 1] ?? null;
};

// Consume the upcoming photo, advancing the position and recording lastPath.
export const advanceQueued = (
  state: RandomQueueState,
  pool: RandomPhotoRow[],
  build: QueueBuilder,
): RandomPhotoRow | null => {
  const upcoming = peekNextQueued(state, pool, build);
  if (!upcoming) {
    return null;
  }
  state.index += 1;
  state.lastPath = upcoming.path;
  return upcoming;
};
