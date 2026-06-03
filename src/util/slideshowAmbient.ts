import { RandomPhotoRow } from "../components/search/api";
import {
  extractDateFromExifString,
  extractGPSFromExifString,
} from "./extractExifFromDb";
import { deltaE, parseColorPalette, rgbToLab } from "./colorDistance";

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
  // sigma ≈ 1.5h: photos within ~1.5h of now score >0.6 on this axis; a
  // 3h-off photo is already down to ~0.14, so the "live time" mode really
  // tracks the current hour rather than just the half-day.
  const hourScore = Math.exp(-(hourDistance ** 2) / (2 * 1.5 * 1.5));

  const monthDistance = cyclicDistance(
    photoDate.getMonth(),
    now.getMonth(),
    12,
  );
  // sigma ≈ 0.8mo: adjacent months still score >0.5, but two-months-off
  // already drops below 0.05 — keeps the season feel without spilling into
  // photos from the opposite half of the year.
  const monthScore = Math.exp(-(monthDistance ** 2) / (2 * 0.8 * 0.8));

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
// keep surfacing. Raising the weight to the 4th power sharpens the curve:
//   score 0.5  → effective 0.0625 (16× less likely than perfect)
//   score 0.2  → effective 0.0016 (625× less likely)
//   score 0.05 → effective 6.25e-6 (160000× less likely)
// — so the top of the refilled queue is dominated by genuinely on-target
// photos, while the floor still lets the occasional off-band photo appear.
const TIME_AWARE_WEIGHT_EXPONENT = 4;

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
 * Returns 0 (no remix), 1 (2-up), 2 (3-up) or 3 (4-up). 2-up is the
 * common case (~70% of remixes); 3-up appears less often (~25%) and
 * the 4-up grid is rare (~5%) because four photos at once is visually
 * busy and harder to digest at a glance.
 *
 * `random` is injectable for tests.
 */
export const decideRemixCompanionCount = (
  remixProbability: number,
  random: () => number = Math.random,
): 0 | 1 | 2 | 3 => {
  if (random() >= remixProbability) {
    return 0;
  }
  return rollRemixLayoutCount(random);
};

/**
 * Pick a layout size (1 = 2-up, 2 = 3-up, 3 = 4-up) under the same band
 * split that `decideRemixCompanionCount` uses for organic dice rolls. Used
 * by the slideshow's "Remix now" button and drag-up gesture so user-forced
 * remixes share the same 70/25/5 distribution as the natural ones.
 *
 * `random` is injectable for tests.
 */
export const rollRemixLayoutCount = (
  random: () => number = Math.random,
): 1 | 2 | 3 => {
  const r = random();
  if (r < 0.7) return 1;
  if (r < 0.95) return 2;
  return 3;
};

export type RemixStrategy =
  | "same-album"
  | "same-year"
  | "same-decade"
  | "same-region"
  | "same-country"
  | "same-city"
  | "same-day-of-year"
  | "dominant-colour"
  | "anniversary"
  | "proximity"
  | "golden-hour"
  | "shared-camera"
  // Vector-only: produced by the SigLIP path in the slideshow component, not
  // by the sync weighted roll. Their entries in `strategyFilters` are no-ops
  // so they can never surface from the sync path even if rolled.
  | "similar"
  | "juxtapose"
  | "random";

export type RemixPick = {
  companions: RandomPhotoRow[];
  strategy: RemixStrategy;
};

const albumOfPath = (path: string): string => path.split("/")?.[2] ?? "";

// Great-circle distance between two GPS points, in kilometres.
// Used by the "proximity" remix strategy to find photos shot near a seed.
export const haversineKm = (
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

// Geocode admin1 / region (e.g. "Hokkaido", "England"). reverse_geocode's
// output places non-numeric lines in this order: country code, city, [admin1,
// admin2], country. Pull the first interior line that isn't the city or the
// country itself. Returns "" for city-states or geocodes that lack a distinct
// admin1 level — so the strategy cleanly falls through to same-country.
const extractAdmin1 = (geocode: string): string => {
  if (!geocode) return "";
  const nonNumeric = geocode
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((line) => Number.isNaN(parseFloat(line)));
  // Country code + city + admin1 + country = 4. Anything shorter doesn't
  // confidently expose an admin1 level.
  if (nonNumeric.length < 4) return "";
  const city = nonNumeric[1];
  const country = nonNumeric[nonNumeric.length - 1];
  for (let i = 2; i < nonNumeric.length - 1; i += 1) {
    const line = nonNumeric[i];
    if (line && line !== country && line !== city) return line;
  }
  return "";
};

// Geocode line 0 is the ISO country code (e.g. "JP", "SG") and line 1 is the
// city name (per reverse_geocode's output). Pull line 1 if it's present and
// non-numeric; otherwise fall back to the first non-numeric line so we never
// accidentally match cities on a coordinate value.
const extractCity = (geocode: string): string => {
  if (!geocode) return "";
  const lines = geocode.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && Number.isNaN(parseFloat(lines[1]))) {
    return lines[1];
  }
  for (const line of lines.slice(1)) {
    if (Number.isNaN(parseFloat(line))) {
      return line;
    }
  }
  return "";
};

// Dominant colour — the first entry in the palette serialised into `colors`.
// Returns null when the palette is missing or unparseable so the matching
// filter can bail without inventing a colour.
const extractDominantLab = (
  colors: string | undefined,
): [number, number, number] | null => {
  if (!colors) return null;
  const palette = parseColorPalette(colors);
  if (palette.length === 0) return null;
  return rgbToLab(...palette[0]);
};

// Delta-E threshold for the dominant-colour remix. ~18 lands in the "clearly
// related" band of perceptual colour distance: tighter than 25 (where colours
// are still recognisably "in the same family") and looser than 10 (where the
// match would feel sterile and the pool would often be empty).
const DOMINANT_COLOUR_DELTAE = 18;

// Camera identity from EXIF — "Make Model" lowercased. Matches the line-based
// "Key: value" format the rest of this module already parses.
const extractCameraId = (exifString: string): string => {
  if (!exifString) return "";
  let make = "";
  let model = "";
  for (const line of exifString.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key === "Image Make") make = value;
    else if (key === "Image Model") model = value;
  }
  if (!make && !model) return "";
  return `${make} ${model}`.trim().toLowerCase();
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
  // Matches at admin1 / region level (e.g. "Hokkaido", "England") — strictly
  // narrower than same-country. The strategy returns [] when the seed lacks
  // a distinct admin1 line, so it cleanly falls through to same-country.
  "same-region": (seed, pool) => {
    const seedRegion = extractAdmin1(seed.geocode);
    if (!seedRegion) return [];
    return pool.filter(
      (p) => p.path !== seed.path && extractAdmin1(p.geocode) === seedRegion,
    );
  },
  // Matches at the country line — broadest of the geo strategies. Distinct
  // from same-region so the badge can honestly say "from the same country"
  // rather than the vague "from the same place".
  "same-country": (seed, pool) => {
    const seedCountry = lastNonNumericLine(seed.geocode);
    if (!seedCountry) return [];
    return pool.filter(
      (p) =>
        p.path !== seed.path &&
        lastNonNumericLine(p.geocode) === seedCountry,
    );
  },
  "same-city": (seed, pool) => {
    const seedCity = extractCity(seed.geocode);
    if (!seedCity) return [];
    return pool.filter(
      (p) => p.path !== seed.path && extractCity(p.geocode) === seedCity,
    );
  },
  // Same calendar day (month + day-of-month) in a different year. Stricter
  // than `anniversary` (which is ±3 days): this is the exact same date you
  // were standing somewhere, years apart.
  "same-day-of-year": (seed, pool) => {
    const seedDate = extractDateFromExifString(seed.exif);
    if (!seedDate) return [];
    const seedMonth = seedDate.getMonth();
    const seedDay = seedDate.getDate();
    const seedYear = seedDate.getFullYear();
    return pool.filter((p) => {
      if (p.path === seed.path) return false;
      const d = extractDateFromExifString(p.exif);
      if (!d) return false;
      if (d.getFullYear() === seedYear) return false;
      return d.getMonth() === seedMonth && d.getDate() === seedDay;
    });
  },
  // Photos whose dominant palette colour is within ~deltaE 18 (LAB) of the
  // seed's dominant colour. Pulls visually coherent pairings — sunsets pair
  // with sunsets, blue hour with blue hour — without needing tag overlap.
  "dominant-colour": (seed, pool) => {
    const seedLab = extractDominantLab(seed.colors);
    if (!seedLab) return [];
    const matches: RandomPhotoRow[] = [];
    for (const candidate of pool) {
      if (candidate.path === seed.path) continue;
      const candidateLab = extractDominantLab(candidate.colors);
      if (!candidateLab) continue;
      if (deltaE(seedLab, candidateLab) <= DOMINANT_COLOUR_DELTAE) {
        matches.push(candidate);
      }
    }
    return matches;
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
  // Same camera body (Make + Model) — pairings share era and colour science
  // even when the subject changes. A "shot through the same eye" remix.
  "shared-camera": (seed, pool) => {
    const seedCamera = extractCameraId(seed.exif);
    if (!seedCamera) return [];
    return pool.filter((p) => {
      if (p.path === seed.path) return false;
      return extractCameraId(p.exif) === seedCamera;
    });
  },
  // Vector strategies — implemented in the slideshow component against the
  // SigLIP embeddings DB. `similar` is nearest-neighbour; `juxtapose` is the
  // farthest-neighbour (anti-similar). Their sync filters return [] so the
  // weighted roll always falls through; the slideshow's vector path is the
  // only producer of these labels.
  similar: () => [],
  juxtapose: () => [],
};

// Extract the raw "Make Model" string from EXIF, preserving original casing
// (unlike extractCameraId which lowercases for matching). Returns "" when the
// camera identity isn't recoverable.
const extractCameraDisplayName = (exifString: string): string => {
  if (!exifString) return "";
  let make = "";
  let model = "";
  for (const line of exifString.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key === "Image Make") make = value;
    else if (key === "Image Model") model = value;
  }
  // Skip the manufacturer prefix when the model already redundantly includes
  // it (e.g. "FUJIFILM" + "FUJIFILM X100V" → "FUJIFILM X100V").
  if (make && model && model.toLowerCase().startsWith(make.toLowerCase())) {
    return model;
  }
  return [make, model].filter(Boolean).join(" ");
};

const formatHourMinute = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatDayMonth = (date: Date): string =>
  date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Max pairwise haversine distance (km) across a slide's photos. The slide is
// a circle and this is its enclosing diameter — the radius the user can see.
// Returns null if fewer than two photos have parseable GPS.
const computeMaxPairwiseKm = (
  photos: ReadonlyArray<RandomPhotoRow | null>,
): number | null => {
  const coords: Array<[number, number]> = [];
  for (const photo of photos) {
    if (!photo) continue;
    const gps = extractGPSFromExifString(photo.exif);
    if (gps) coords.push(gps);
  }
  if (coords.length < 2) return null;
  let max = 0;
  for (let i = 0; i < coords.length; i += 1) {
    for (let j = i + 1; j < coords.length; j += 1) {
      const d = haversineKm(
        coords[i][0],
        coords[i][1],
        coords[j][0],
        coords[j][1],
      );
      if (d > max) max = d;
    }
  }
  return max;
};

const formatSpreadKm = (km: number): string => {
  if (km < 1) return `within ${Math.round(km * 1000)} m`;
  if (km < 10) return `within ${km.toFixed(1)} km`;
  return `within ${Math.round(km)} km`;
};

const collectDates = (
  photos: ReadonlyArray<RandomPhotoRow | null>,
): Date[] => {
  const dates: Date[] = [];
  for (const photo of photos) {
    if (!photo) continue;
    const d = extractDateFromExifString(photo.exif);
    if (d) dates.push(d);
  }
  return dates;
};

/**
 * Describe a remix slide with a short, descriptive suffix appended to the
 * strategy label (e.g. "shot nearby · within 740 m"). Returns null when the
 * strategy has no descriptor or the photos lack the needed metadata.
 *
 * The vector strategies (`similar`, `juxtapose`) and the visual
 * `dominant-colour` swatch are deliberately not handled here — they need
 * extra state / non-text rendering that lives in the slideshow component.
 */
export const describeRemix = (
  strategy: RemixStrategy,
  photos: ReadonlyArray<RandomPhotoRow | null>,
): string | null => {
  switch (strategy) {
    case "proximity": {
      const spread = computeMaxPairwiseKm(photos);
      return spread === null ? null : formatSpreadKm(spread);
    }
    case "same-album": {
      const seed = photos[0];
      const album = seed ? albumOfPath(seed.path) : "";
      return album || null;
    }
    case "same-city": {
      const seed = photos[0];
      const city = seed ? extractCity(seed.geocode) : "";
      return city || null;
    }
    case "same-region": {
      const seed = photos[0];
      const region = seed ? extractAdmin1(seed.geocode) : "";
      return region || null;
    }
    case "same-country": {
      const seed = photos[0];
      const country = seed ? lastNonNumericLine(seed.geocode) : "";
      return country || null;
    }
    case "same-year": {
      const dates = collectDates(photos);
      if (dates.length === 0) return null;
      return String(dates[0].getFullYear());
    }
    case "same-decade": {
      const dates = collectDates(photos);
      if (dates.length === 0) return null;
      const years = dates.map((d) => d.getFullYear()).sort((a, b) => a - b);
      if (years[0] === years[years.length - 1]) return String(years[0]);
      return `${years[0]}–${years[years.length - 1]}`;
    }
    case "same-day-of-year": {
      const dates = collectDates(photos);
      if (dates.length === 0) return null;
      const day = formatDayMonth(dates[0]);
      const years = Array.from(
        new Set(dates.map((d) => d.getFullYear())),
      ).sort((a, b) => a - b);
      return `${day} · ${years.join(", ")}`;
    }
    case "anniversary": {
      const dates = collectDates(photos);
      if (dates.length === 0) return null;
      const years = Array.from(
        new Set(dates.map((d) => d.getFullYear())),
      ).sort((a, b) => a - b);
      return years.join(", ");
    }
    case "golden-hour": {
      const dates = collectDates(photos);
      if (dates.length === 0) return null;
      return dates.map(formatHourMinute).join(" · ");
    }
    case "shared-camera": {
      const seed = photos[0];
      const name = seed ? extractCameraDisplayName(seed.exif) : "";
      return name || null;
    }
    default:
      return null;
  }
};

/**
 * For the `dominant-colour` strategy: extract the seed photo's dominant
 * palette colour for rendering as a swatch alongside the remix label.
 * Returns null when the strategy isn't dominant-colour or the seed has no
 * parseable palette.
 */
export const getRemixSwatchRgb = (
  strategy: RemixStrategy,
  photos: ReadonlyArray<RandomPhotoRow | null>,
): [number, number, number] | null => {
  if (strategy !== "dominant-colour") return null;
  const seed = photos[0];
  if (!seed?.colors) return null;
  const palette = parseColorPalette(seed.colors);
  return palette.length > 0 ? palette[0] : null;
};

// Probability weights for one unified roll across every strategy, including
// `similar` and `juxtapose` (SigLIP / anti-SigLIP). Vector strategies have to
// be resolved asynchronously by the slideshow component; the sync entry
// `pickRemixCompanions` treats them as no-ops and falls through, so the
// slideshow is responsible for handling the async path when those names are
// rolled (see `rollRemixStrategy`).
const STRATEGY_WEIGHTS: Array<[RemixStrategy, number]> = [
  ["similar", 0.2],
  ["same-album", 0.12],
  ["proximity", 0.1],
  ["dominant-colour", 0.1],
  ["juxtapose", 0.08],
  ["anniversary", 0.08],
  ["golden-hour", 0.06],
  ["same-city", 0.06],
  ["same-region", 0.05],
  ["same-year", 0.04],
  ["shared-camera", 0.04],
  ["same-day-of-year", 0.03],
  ["same-country", 0.02],
  ["same-decade", 0.01],
  ["random", 0.01],
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
 * Public weighted roll for callers that need to dispatch on the chosen
 * strategy before resolving companions (e.g. the slideshow component takes
 * the async SigLIP path when the roll picks `similar` or `juxtapose`).
 */
export const rollRemixStrategy = (
  random: () => number = Math.random,
): RemixStrategy => pickWeightedStrategy(random);

/** Vector-resolved strategies — the sync filter chain can't produce them. */
export const VECTOR_REMIX_STRATEGIES = new Set<RemixStrategy>([
  "similar",
  "juxtapose",
]);

/**
 * Pick `count` companion photos for a remix slide. Rolls a weighted die to
 * choose a *strategy* (same-album / same-year / same-region / random) and
 * returns companions plus the strategy used so the UI can
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
  presetStrategy?: RemixStrategy,
): RemixPick => {
  if (count <= 0 || pool.length < count + 1) {
    return { companions: [], strategy: "random" };
  }

  // Honour a strategy the caller already rolled (the slideshow rolls once to
  // decide between the async vector path and this sync path). Without this we
  // re-roll from scratch — and any roll that lands on a vector strategy
  // (no-op here) funnels straight into same-album as the first dense fallback.
  const rolled = presetStrategy ?? pickWeightedStrategy(random);
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
