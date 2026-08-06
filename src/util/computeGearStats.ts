import type { Content, PhotoBlock } from "../services/types";
import { parseExifLocalDateTime } from "./exifTime";
import { APERTURE_FACET, CAMERA_FACET, ISO_FACET, LENS_FACET } from "./photoBuckets";

/**
 * What the gear section knows beyond an inventory.
 *
 * The camera and lens counts say what is owned. These say what is done with it:
 * when each body was the one being carried, what it was typically set to, and
 * where along its range a zoom actually gets used. All of it is read off the
 * same EXIF the facets are, and none of it is reachable from a count.
 */

export type CameraYearShare = {
  /** The year, as a label — this is an axis, not a number to do sums with. */
  label: string;
  total: number;
  /** Busiest body first, so the handover reads down the page. */
  cameras: Array<{ camera: string; count: number; share: number }>;
};

export type CameraProfile = {
  camera: string;
  count: number;
  /** Per cent of every dated, identified frame in the archive. */
  share: number;
  /** First and last year it took a photograph, inclusive. */
  years: [number, number] | null;
  /**
   * The middle of what it was set to. `equivalent` is false where the body
   * never reported a 35mm-equivalent focal length and the physical one is all
   * there is — a 23mm reading means something different on each.
   */
  focalLength: { mm: number; equivalent: boolean } | null;
  aperture: number | null;
  iso: number | null;
  /** The four-hour stretch that holds most of its frames; `to` may wrap past midnight. */
  busiestHours: { from: number; to: number } | null;
  topLens: { label: string; share: number } | null;
  topPlace: { label: string; share: number } | null;
};

export type LensFocalRange = {
  lens: string;
  count: number;
  shortest: number;
  longest: number;
  /** Even bins across the lens's own range, so the shape is the lens's own. */
  buckets: Array<{ from: number; to: number; count: number; share: number }>;
};

export type GearStats = {
  cameraYears: CameraYearShare[];
  cameraProfiles: CameraProfile[];
  lensFocalRanges: LensFocalRange[];
};

/** Bins per lens: enough to show a gap at the middle of a zoom, few enough to read. */
const FOCAL_BINS = 12;
/** Below this a lens's shape is noise, and a prime has no shape at all. */
const MIN_LENS_FRAMES = 12;
const BUSIEST_HOURS_SPAN = 4;

const isTestAlbum = (album: Content): boolean =>
  album.name?.startsWith("test-") === true || album._build.slug.startsWith("test-");

/**
 * A reading only counts if it is a reading.
 *
 * Phones write a zero focal length rather than leaving the tag out, and a body
 * summarised as shooting at "0mm" is worse than one that says nothing: the Nexus
 * 5X reported exactly that.
 */
const measured = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * The middle value, taking the upper of the two when there is no single middle.
 *
 * The median rather than the mean throughout: one frame at ISO 12800 in a cave
 * should not move what a body is "usually" set to.
 */
const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
};

const busiestSpan = (hours: number[]): { from: number; to: number } | null => {
  if (hours.length === 0) return null;

  const counts = Array.from({ length: 24 }, () => 0);
  for (const hour of hours) counts[hour] = (counts[hour] ?? 0) + 1;

  // Around the clock, so a camera carried at 23:00 and 01:00 is described as
  // being out at night rather than at noon, which is where a median lands.
  let best = { from: 0, total: -1 };
  for (let from = 0; from < 24; from += 1) {
    let total = 0;
    for (let step = 0; step < BUSIEST_HOURS_SPAN; step += 1) {
      total += counts[(from + step) % 24] ?? 0;
    }
    if (total > best.total) best = { from, total };
  }

  return { from: best.from, to: (best.from + BUSIEST_HOURS_SPAN - 1) % 24 };
};

const topOf = (counts: Map<string, number>, total: number) => {
  const best = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0];

  return best && total > 0 ? { label: best[0], share: Math.round((best[1] / total) * 100) } : null;
};

/** The town a photograph was taken in, as the geocode writes it. */
const placeOf = (photo: PhotoBlock): string | null => {
  const geocode = photo._build.tags?.geocode;
  if (typeof geocode !== "string") return null;

  const lines = geocode
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const town = lines[0];
  const country = lines.at(-1);
  if (!town) return null;

  return country && country !== town ? `${town}, ${country}` : town;
};

type CameraFrames = {
  count: number;
  focal35: number[];
  focal: number[];
  apertures: number[];
  isos: number[];
  hours: number[];
  lenses: Map<string, number>;
  places: Map<string, number>;
  firstYear: number;
  lastYear: number;
};

const emptyFrames = (): CameraFrames => ({
  count: 0,
  focal35: [],
  focal: [],
  apertures: [],
  isos: [],
  hours: [],
  lenses: new Map(),
  places: new Map(),
  firstYear: Infinity,
  lastYear: -Infinity,
});

export const computeGearStats = (albums: Content[]): GearStats => {
  const photos = albums
    .filter((album) => !isTestAlbum(album))
    .flatMap((album) => album.blocks)
    .filter((block): block is PhotoBlock => block.kind === "photo");

  const byCamera = new Map<string, CameraFrames>();
  const byYear = new Map<string, Map<string, number>>();
  const byLens = new Map<string, number[]>();
  let identified = 0;

  for (const photo of photos) {
    const exif = photo._build?.exif;
    if (!exif) continue;

    const lens = LENS_FACET.extract(exif, photo._build.tags ?? undefined);
    const focal = exif.FocalLength ?? null;
    if (lens && measured(focal)) {
      byLens.set(lens, [...(byLens.get(lens) ?? []), focal]);
    }

    const camera = CAMERA_FACET.extract(exif, photo._build.tags ?? undefined);
    if (!camera) continue;

    identified += 1;
    const frames = byCamera.get(camera) ?? emptyFrames();
    frames.count += 1;

    const focal35 = exif.FocalLengthIn35mmFormat;
    if (measured(focal35)) frames.focal35.push(focal35);
    if (measured(focal)) frames.focal.push(focal);

    const aperture = APERTURE_FACET.extract(exif, photo._build.tags ?? undefined);
    if (measured(aperture)) frames.apertures.push(aperture);
    const iso = ISO_FACET.extract(exif, photo._build.tags ?? undefined);
    if (measured(iso)) frames.isos.push(iso);
    if (lens) frames.lenses.set(lens, (frames.lenses.get(lens) ?? 0) + 1);
    const place = placeOf(photo);
    if (place) frames.places.set(place, (frames.places.get(place) ?? 0) + 1);

    const taken = parseExifLocalDateTime(exif.DateTimeOriginal);
    if (taken) {
      frames.hours.push(taken.hour);
      frames.firstYear = Math.min(frames.firstYear, taken.year);
      frames.lastYear = Math.max(frames.lastYear, taken.year);

      const yearKey = String(taken.year);
      const year = byYear.get(yearKey) ?? new Map<string, number>();
      year.set(camera, (year.get(camera) ?? 0) + 1);
      byYear.set(yearKey, year);
    }

    byCamera.set(camera, frames);
  }

  const cameraYears: CameraYearShare[] = [...byYear.entries()]
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .map(([label, counts]) => {
      const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
      return {
        label,
        total,
        cameras: [...counts.entries()]
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .map(([camera, count]) => ({
            camera,
            count,
            share: total > 0 ? (count / total) * 100 : 0,
          })),
      };
    });

  const cameraProfiles: CameraProfile[] = [...byCamera.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .map(([camera, frames]): CameraProfile => {
      // The equivalent where the body reports one, and the physical length only
      // where it never does — never one standing in for the other silently.
      const equivalent = frames.focal35.length > 0;
      const focalMedian = median(equivalent ? frames.focal35 : frames.focal);

      return {
        camera,
        count: frames.count,
        share: identified > 0 ? Math.round((frames.count / identified) * 100) : 0,
        years: frames.firstYear === Infinity ? null : [frames.firstYear, frames.lastYear],
        focalLength: focalMedian === null ? null : { mm: focalMedian, equivalent },
        aperture: median(frames.apertures),
        iso: median(frames.isos),
        busiestHours: busiestSpan(frames.hours),
        topLens: topOf(frames.lenses, frames.count),
        topPlace: topOf(frames.places, frames.count),
      };
    });

  const lensFocalRanges: LensFocalRange[] = [...byLens.entries()]
    .filter(([, lengths]) => lengths.length >= MIN_LENS_FRAMES)
    .flatMap(([lens, lengths]) => {
      const shortest = Math.min(...lengths);
      const longest = Math.max(...lengths);
      // A prime is one number: a distribution across no range is a division by
      // zero dressed as a chart.
      if (longest <= shortest) return [];

      const width = (longest - shortest) / FOCAL_BINS;
      const counts = Array.from({ length: FOCAL_BINS }, () => 0);
      for (const length of lengths) {
        const bin = Math.min(FOCAL_BINS - 1, Math.floor((length - shortest) / width));
        counts[bin] = (counts[bin] ?? 0) + 1;
      }

      return [
        {
          lens,
          count: lengths.length,
          shortest,
          longest,
          buckets: counts.map((count, index) => ({
            from: Math.round(shortest + index * width),
            to: Math.round(shortest + (index + 1) * width),
            count,
            share: (count / lengths.length) * 100,
          })),
        },
      ];
    })
    .sort((left, right) => right.count - left.count || left.lens.localeCompare(right.lens));

  return { cameraYears, cameraProfiles, lensFocalRanges };
};
