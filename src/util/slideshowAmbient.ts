import { RandomPhotoRow } from "../components/search/api";
import {
  extractDateFromExifString,
  extractGPSFromExifString,
} from "./extractExifFromDb";

/**
 * Cyclic distance on a wraparound axis (e.g. hour-of-day on 24, month on 12).
 * Returns the shorter of forward and backward distance.
 */
const cyclicDistance = (a: number, b: number, period: number): number => {
  const raw = Math.abs(a - b) % period;
  return Math.min(raw, period - raw);
};

/**
 * Score how well a photo's timestamp matches "now" by hour-of-day and
 * month-of-year. Returns a multiplicative weight in roughly [0.02, 1].
 *
 * The two axes combine *multiplicatively* (joint Gaussian density) rather
 * than as an arithmetic mean — a photo needs to land near both the current
 * hour AND the current month to score high. With an arithmetic mean, a
 * photo matching only one axis still scored 0.5, which made the displayed
 * "% match" feel weakly correlated with the actual selection bias.
 */
export const getTimeAffinityScore = (
  photoDate: Date,
  now: Date = new Date(),
): number => {
  const hourDistance = cyclicDistance(
    photoDate.getHours() + photoDate.getMinutes() / 60,
    now.getHours() + now.getMinutes() / 60,
    24,
  );
  // sigma ≈ 2.5h: photos within ~2.5 hours of now score >0.6 on this axis.
  const hourScore = Math.exp(-(hourDistance ** 2) / (2 * 2.5 * 2.5));

  const monthDistance = cyclicDistance(
    photoDate.getMonth(),
    now.getMonth(),
    12,
  );
  // sigma ≈ 1.25mo: same-season photos score >0.6 on this axis.
  const monthScore = Math.exp(-(monthDistance ** 2) / (2 * 1.25 * 1.25));

  // Joint affinity: BOTH axes must match for a high score. A photo that's
  // the right hour but wrong season (or vice versa) lands around 0.3, not 0.5.
  // Floor at 0.02 so completely off-band photos can still surface
  // occasionally — without it the rotation can collapse to a handful of
  // photos near the boundary.
  return Math.max(0.02, hourScore * monthScore);
};

// How sharply to bias the shuffle toward high-affinity photos. Raw scores
// already differ by ~50× (floor 0.02 to perfect 1.0), but with thousands of
// low-affinity photos in the pool their cumulative weight still dominates a
// handful of high-affinity ones — so the rotation feels linear and 2% photos
// keep surfacing. Cubing the weight (3rd power) sharpens the curve:
//   score 0.5  → effective 0.125 (8× less likely than perfect)
//   score 0.2  → effective 0.008 (125× less likely)
//   score 0.05 → effective 0.000125 (8000× less likely)
// — so the top of the refilled queue is dominated by genuinely on-target
// photos, while the floor still lets the occasional off-band photo appear.
const TIME_AWARE_WEIGHT_EXPONENT = 3;

/**
 * Weighted Fisher-Yates equivalent: assigns each photo a key derived from
 * its time-affinity weight and a random draw, then sorts ascending.
 * Matches the pattern used in weightedShufflePhotos.
 */
export const timeAwareShufflePhotos = (
  photos: RandomPhotoRow[],
  now: Date = new Date(),
): RandomPhotoRow[] => {
  const scored = photos.map((photo) => {
    const photoDate = extractDateFromExifString(photo.exif);
    const score = photoDate ? getTimeAffinityScore(photoDate, now) : 0.1;
    const weight = score ** TIME_AWARE_WEIGHT_EXPONENT;
    const randomValue = Math.max(Math.random(), Number.EPSILON);
    return {
      photo,
      key: -Math.log(randomValue) / weight,
    };
  });

  scored.sort((left, right) => left.key - right.key);
  return scored.map((entry) => entry.photo);
};

/**
 * Decide whether the next slide should be a remix and, if so, how many
 * companion photos it should pair with the seed.
 *
 * Returns 0 (no remix), 1 (2-up) or 2 (3-up). 2-up is intentionally more
 * common than 3-up — three-photo grids are visually busier.
 *
 * `random` is injectable for tests.
 */
export const decideRemixCompanionCount = (
  remixProbability: number,
  random: () => number = Math.random,
): 0 | 1 | 2 => {
  if (random() >= remixProbability) {
    return 0;
  }
  return random() < 0.7 ? 1 : 2;
};

export type RemixStrategy =
  | "same-album"
  | "same-year"
  | "same-decade"
  | "same-time-of-day"
  | "same-region"
  | "anniversary"
  | "proximity"
  | "golden-hour"
  | "juxtapose"
  | "similar"
  | "random";

export type RemixPick = {
  companions: RandomPhotoRow[];
  strategy: RemixStrategy;
};

const albumOfPath = (path: string): string => path.split("/")?.[2] ?? "";

// Great-circle distance between two GPS points, in kilometres.
// Used by the "proximity" remix strategy to find photos shot near a seed.
const haversineKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
};

// Geocode strings in the DB are line-separated; the last non-numeric line is
// typically the country (with the prior lines being region, city, etc.).
// Matching on the *last* line is the most stable cohesion criterion.
const lastNonNumericLine = (geocode: string): string => {
  if (!geocode) return "";
  const lines = geocode.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (Number.isNaN(parseFloat(line))) {
      return line;
    }
  }
  return "";
};

const shuffleInPlace = (
  arr: RandomPhotoRow[],
  random: () => number,
): RandomPhotoRow[] => {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// Each strategy returns the *candidate pool* (already filtered, seed-excluded)
// for a given seed and pool. The caller shuffles and slices to `count`.
const strategyFilters: Record<
  Exclude<RemixStrategy, "random">,
  (seed: RandomPhotoRow, pool: RandomPhotoRow[]) => RandomPhotoRow[]
> = {
  "same-album": (seed, pool) => {
    const seedAlbum = albumOfPath(seed.path);
    if (!seedAlbum) return [];
    return pool.filter(
      (p) => p.path !== seed.path && albumOfPath(p.path) === seedAlbum,
    );
  },
  "same-year": (seed, pool) => {
    const seedDate = extractDateFromExifString(seed.exif);
    if (!seedDate) return [];
    const seedYear = seedDate.getFullYear();
    return pool.filter((p) => {
      if (p.path === seed.path) return false;
      const d = extractDateFromExifString(p.exif);
      return d?.getFullYear() === seedYear;
    });
  },
  "same-time-of-day": (seed, pool) => {
    const seedDate = extractDateFromExifString(seed.exif);
    if (!seedDate) return [];
    const seedHour = seedDate.getHours();
    return pool.filter((p) => {
      if (p.path === seed.path) return false;
      const d = extractDateFromExifString(p.exif);
      if (!d) return false;
      const hour = d.getHours();
      // ±2h, wrapping at midnight
      const diff = Math.abs(hour - seedHour);
      const wrappedDiff = Math.min(diff, 24 - diff);
      return wrappedDiff <= 2;
    });
  },
  "same-region": (seed, pool) => {
    const seedRegion = lastNonNumericLine(seed.geocode);
    if (!seedRegion) return [];
    return pool.filter(
      (p) =>
        p.path !== seed.path &&
        lastNonNumericLine(p.geocode) === seedRegion,
    );
  },
  // "This week, in past years" — same calendar day-of-year ±3, any year.
  // Evocative for slideshows on a sideboard: a memory from this exact week
  // years ago, sitting next to today.
  anniversary: (seed, pool) => {
    const seedDate = extractDateFromExifString(seed.exif);
    if (!seedDate) return [];
    const seedDoy =
      Math.floor((seedDate.getTime() - new Date(seedDate.getFullYear(), 0, 0).getTime()) / 86400000);
    return pool.filter((p) => {
      if (p.path === seed.path) return false;
      const d = extractDateFromExifString(p.exif);
      if (!d) return false;
      // Different year required so it's a real anniversary, not the same day.
      if (d.getFullYear() === seedDate.getFullYear()) return false;
      const doy =
        Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000);
      const diff = Math.abs(doy - seedDoy);
      const wrappedDiff = Math.min(diff, 365 - diff);
      return wrappedDiff <= 3;
    });
  },
  // Same decade as seed — broader temporal grouping than same-year. E.g.,
  // an early-2020s remix mixes 2021 and 2024 photos.
  "same-decade": (seed, pool) => {
    const seedDate = extractDateFromExifString(seed.exif);
    if (!seedDate) return [];
    const seedDecade = Math.floor(seedDate.getFullYear() / 10);
    return pool.filter((p) => {
      if (p.path === seed.path) return false;
      const d = extractDateFromExifString(p.exif);
      if (!d) return false;
      // Exclude same-year to keep the strategy distinct from same-year.
      if (d.getFullYear() === seedDate.getFullYear()) return false;
      return Math.floor(d.getFullYear() / 10) === seedDecade;
    });
  },
  // GPS proximity via Haversine — within ~50km of the seed, but biased
  // toward the seed's nearest neighbours so a 3-up grid stays a tight cluster
  // instead of fanning across the full 50km radius. The outer cap keeps the
  // pool sane on big cities; the inner top-N keeps the picks visually local.
  proximity: (seed, pool) => {
    const seedCoords = extractGPSFromExifString(seed.exif);
    if (!seedCoords) return [];
    const [seedLat, seedLng] = seedCoords;
    const PROXIMITY_KM = 50;
    const NEAREST_POOL_SIZE = 8;

    const withDistance: Array<{ photo: RandomPhotoRow; distance: number }> = [];
    for (const candidate of pool) {
      if (candidate.path === seed.path) continue;
      const coords = extractGPSFromExifString(candidate.exif);
      if (!coords) continue;
      const distance = haversineKm(seedLat, seedLng, coords[0], coords[1]);
      if (distance > PROXIMITY_KM) continue;
      withDistance.push({ photo: candidate, distance });
    }

    withDistance.sort((a, b) => a.distance - b.distance);
    return withDistance
      .slice(0, NEAREST_POOL_SIZE)
      .map((entry) => entry.photo);
  },
  // Photos shot at golden hour — roughly the hour around sunrise (5-7am)
  // or sunset (5-7pm). Both seed and candidate must be in the band, so a
  // golden-hour remix is a colour-temperature mood piece.
  "golden-hour": (seed, pool) => {
    const seedDate = extractDateFromExifString(seed.exif);
    if (!seedDate) return [];
    const inGoldenHour = (hour: number) =>
      (hour >= 5 && hour <= 7) || (hour >= 17 && hour <= 19);
    if (!inGoldenHour(seedDate.getHours())) return [];
    return pool.filter((p) => {
      if (p.path === seed.path) return false;
      const d = extractDateFromExifString(p.exif);
      if (!d) return false;
      return inGoldenHour(d.getHours());
    });
  },
  // Deliberate anti-cohesion: photos from a *different* album AND different
  // region than the seed. Maximises the chance of a surprising visual
  // pairing — a city night next to a desert dawn.
  juxtapose: (seed, pool) => {
    const seedAlbum = albumOfPath(seed.path);
    const seedRegion = lastNonNumericLine(seed.geocode);
    return pool.filter((p) => {
      if (p.path === seed.path) return false;
      const album = albumOfPath(p.path);
      if (album === seedAlbum) return false;
      // If we don't know the seed's region, the album diff alone is enough.
      if (!seedRegion) return true;
      const region = lastNonNumericLine(p.geocode);
      return region !== seedRegion;
    });
  },
  // SigLIP-backed semantic similarity. Real similarity requires an async
  // embeddings DB query (see fetchSimilarResults in components/search/api),
  // which doesn't fit the sync filter signature here. Returns [] so the
  // strategy roll falls through to the next candidate. The slideshow
  // component can wire in an async post-commit hook to populate this case
  // when embeddings are available; left intentionally unimplemented in the
  // sync util to keep this module side-effect-free and unit-testable.
  similar: () => [],
};

// Probability weights when rolling for the next strategy. Same-album leads
// because trip-cohesion is the most obviously meaningful pairing; juxtapose
// is kept low because over-frequent anti-cohesion feels chaotic; random is
// the universal fallback. Weights need not sum to 1 — `pickWeightedStrategy`
// normalises by the total.
// Note: the slideshow component additionally runs its own 40% coin flip to
// reach for the vector-based (SigLIP) strategies before falling back to this
// weighted roll. So these weights only apply for the ~60% of remixes that
// don't use the embeddings DB. The list intentionally over-represents
// juxtapose so the sync-only sideboard still gets a healthy dose of
// contrast pairings.
const STRATEGY_WEIGHTS: Array<[RemixStrategy, number]> = [
  ["same-album", 0.2],
  ["same-year", 0.1],
  ["same-region", 0.12],
  ["same-time-of-day", 0.08],
  ["anniversary", 0.08],
  ["proximity", 0.08],
  ["golden-hour", 0.06],
  ["same-decade", 0.06],
  ["juxtapose", 0.16],
  ["random", 0.06],
];

const pickWeightedStrategy = (random: () => number): RemixStrategy => {
  const total = STRATEGY_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let r = random() * total;
  for (const [strategy, weight] of STRATEGY_WEIGHTS) {
    r -= weight;
    if (r < 0) return strategy;
  }
  return "random";
};

/**
 * Pick `count` companion photos for a remix slide. Rolls a weighted die to
 * choose a *strategy* (same-album / same-year / same-region / same-time-of-day
 * / random) and returns companions plus the strategy used so the UI can
 * describe why these photos were grouped.
 *
 * If the rolled strategy yields too few candidates, falls back through the
 * remaining strategies in priority order, then to pure random.
 *
 * Never returns the seed itself, and never returns duplicates.
 *
 * `random` is injectable for tests.
 */
export const pickRemixCompanions = (
  seed: RandomPhotoRow,
  pool: RandomPhotoRow[],
  count: number,
  random: () => number = Math.random,
): RemixPick => {
  if (count <= 0 || pool.length < count + 1) {
    return { companions: [], strategy: "random" };
  }

  const rolled = pickWeightedStrategy(random);
  // Try rolled strategy first, then the others (preserving STRATEGY_WEIGHTS
  // order minus the rolled one), with pure-random as the universal fallback.
  const order: RemixStrategy[] = [
    rolled,
    ...STRATEGY_WEIGHTS.map(([s]) => s).filter((s) => s !== rolled),
  ];

  for (const strategy of order) {
    if (strategy === "random") {
      const fallback = pool.filter((p) => p.path !== seed.path);
      const companions = shuffleInPlace([...fallback], random).slice(0, count);
      if (companions.length === count) {
        return { companions, strategy: "random" };
      }
      continue;
    }
    const filtered = strategyFilters[strategy](seed, pool);
    if (filtered.length >= count) {
      const companions = shuffleInPlace([...filtered], random).slice(0, count);
      return { companions, strategy };
    }
  }

  return { companions: [], strategy: "random" };
};
