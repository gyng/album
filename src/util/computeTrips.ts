import { exifDayKey, parseExifLocalDateTime } from "./exifTime";

/**
 * The least a photo has to say about itself to be placed in a trip.
 *
 * Deliberately minimal so one implementation serves both callers: the build,
 * which runs this over every album to summarise trips for the explore page, and
 * the browser, which runs it over the photos an album page already holds so its
 * Trips view costs no extra payload.
 */
export type TripPhoto = {
  /** Camera-local wall clock. Naive ISO, or an EXIF-style timestamp. */
  date: string | null;
  album: string;
  src: string;
  href: string;
  label: string;
  country?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  swatch?: string;
};

export type TripDay = {
  date: string;
  count: number;
  /** First and last wall-clock time of the day, "HH:MM". */
  from: string;
  to: string;
  places: string[];
  photos: TripPhoto[];
  /** Ground covered between the day's own frames. */
  coveredKm: number | null;
  /** How far the day's centre of gravity moved from the previous day's. */
  movedKm: number | null;
};

export type Trip = {
  id: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  photoCount: number;
  country: string | null;
  places: string[];
  albums: string[];
  days: TripDay[];
  /** A single day is an outing, not a journey; the two want different treatment. */
  isOuting: boolean;
  totalKm: number | null;
};

/**
 * A trip stripped of its day-by-day detail, for pages that only list journeys.
 *
 * The explore page ships one of these per trip to every reader, so it carries a
 * handful of frames and nothing else: the full `days` array is the album view's
 * concern, and that recomputes it in the browser from photos it already holds.
 */
export type TripSummary = Omit<Trip, "days"> & { photos: TripPhoto[] };

/** A journey survives a day or two without photographs. Five days apart is not one trip. */
const MAX_GAP_DAYS = 3;
/** Below this an overnight "move" is GPS noise or a walk, not a change of base. */
const MIN_MOVE_KM = 1;
const EARTH_RADIUS_KM = 6371;

const toRadians = (value: number) => (value * Math.PI) / 180;

export const distanceKm = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

const dayNumber = (dayKey: string): number =>
  Date.UTC(
    Number(dayKey.slice(0, 4)),
    Number(dayKey.slice(5, 7)) - 1,
    Number(dayKey.slice(8, 10)),
  ) / 86_400_000;

const located = (photo: TripPhoto): photo is TripPhoto & { lat: number; lng: number } =>
  typeof photo.lat === "number" && typeof photo.lng === "number";

const centre = (photos: TripPhoto[]): { lat: number; lng: number } | null => {
  const points = photos.filter(located);
  if (points.length === 0) return null;
  return {
    lat: points.reduce((total, p) => total + p.lat, 0) / points.length,
    lng: points.reduce((total, p) => total + p.lng, 0) / points.length,
  };
};

/** Places in the order they were reached; a continued stay is not a new arrival. */
const placeSequence = (photos: TripPhoto[]): string[] => {
  const sequence: string[] = [];
  for (const photo of photos) {
    if (photo.city && photo.city !== sequence[sequence.length - 1]) sequence.push(photo.city);
  }
  return sequence;
};

const dominantCountry = (photos: TripPhoto[]): string | null => {
  const counts = new Map<string, number>();
  for (const photo of photos) {
    if (photo.country) counts.set(photo.country, (counts.get(photo.country) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [country, count] of counts) {
    if (count > bestCount) {
      best = country;
      bestCount = count;
    }
  }
  return best;
};

const clockTime = (raw: string): string => {
  const parsed = parseExifLocalDateTime(raw);
  if (!parsed) return "";
  return `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
};

/**
 * Group photographs into the journeys they were taken on.
 *
 * A trip is a maximal run of shooting days where consecutive days are at most
 * three apart *and* the country does not change. The country rule is not
 * decoration: without it a single frame taken at home on a Tuesday welds two
 * separate journeys into one.
 *
 * Days come from `exifDayKey`, the camera's own wall clock, so a photograph
 * taken at 23:30 belongs to the day it was taken on rather than the next one.
 */
export function computeTrips(photos: TripPhoto[]): Trip[] {
  const byDay = new Map<string, TripPhoto[]>();
  for (const photo of photos) {
    const key = exifDayKey(photo.date);
    if (!key) continue;
    const existing = byDay.get(key);
    if (existing) existing.push(photo);
    else byDay.set(key, [photo]);
  }

  const dayKeys = Array.from(byDay.keys()).sort();
  if (dayKeys.length === 0) return [];

  const runs: string[][] = [];
  let run: string[] = [];
  for (const key of dayKeys) {
    const previous = run[run.length - 1];
    const sameCountry =
      previous === undefined ||
      dominantCountry(byDay.get(previous)!) === dominantCountry(byDay.get(key)!);
    if (
      previous !== undefined &&
      (dayNumber(key) - dayNumber(previous) > MAX_GAP_DAYS || !sameCountry)
    ) {
      runs.push(run);
      run = [];
    }
    run.push(key);
  }
  runs.push(run);

  const trips = runs.map((keys): Trip => {
    const dayPhotos = keys.map((key) =>
      [...byDay.get(key)!].sort((left, right) => (left.date ?? "").localeCompare(right.date ?? "")),
    );
    const all = dayPhotos.flat();

    let previousCentre: { lat: number; lng: number } | null = null;
    const days = keys.map((key, index): TripDay => {
      const items = dayPhotos[index]!;
      const points = items.filter(located);
      const coveredKm =
        points.length > 1
          ? points.slice(1).reduce((total, point, i) => total + distanceKm(points[i]!, point), 0)
          : null;
      const here = centre(items);
      const movedKm =
        previousCentre && here && distanceKm(previousCentre, here) >= MIN_MOVE_KM
          ? distanceKm(previousCentre, here)
          : null;
      if (here) previousCentre = here;

      return {
        date: key,
        count: items.length,
        from: clockTime(items[0]?.date ?? ""),
        to: clockTime(items[items.length - 1]?.date ?? ""),
        places: placeSequence(items),
        photos: items,
        coveredKm,
        movedKm,
      };
    });

    const totalKm = days.reduce(
      (total, day) => total + (day.coveredKm ?? 0) + (day.movedKm ?? 0),
      0,
    );

    return {
      id: keys[0]!,
      startDate: keys[0]!,
      endDate: keys[keys.length - 1]!,
      dayCount: keys.length,
      photoCount: all.length,
      country: dominantCountry(all),
      places: Array.from(new Set(placeSequence(all))),
      albums: Array.from(new Set(all.map((photo) => photo.album))).sort(),
      days,
      isOuting: keys.length === 1,
      totalKm: totalKm > 0 ? totalKm : null,
    };
  });

  return trips.sort((left, right) => right.startDate.localeCompare(left.startDate));
}

/** Reduce trips to what a list needs: no days, and only `photoLimit` frames each. */
export function summariseTrips(trips: Trip[], photoLimit: number): TripSummary[] {
  return trips.map(({ days, ...trip }) => ({
    ...trip,
    photos: days.flatMap((day) => day.photos).slice(0, photoLimit),
  }));
}
