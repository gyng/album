import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import exifr from "exifr";
// Shared pure helpers from the main app — the "workspace-lite" seam.
import { getDegLatLngFromExif } from "../../../src/util/dms2deg";
import { dateToNaiveIso } from "../../../src/util/exifTime";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the folder browser opens by default. The repo root so the bundled
 * albums/ dir is one click away; override to start at your own photo library.
 */
export const DEFAULT_ROOT = process.env.GEOTAG_START_DIR
  ? path.resolve(process.env.GEOTAG_START_DIR)
  : path.resolve(here, "../../..");

const IMAGE_RE = /\.(jpe?g|png|tiff?|heic|heif|webp)$/i;
const isImage = (name: string): boolean => IMAGE_RE.test(name);

export type GeotagPhoto = {
  filename: string;
  path: string;
  dateTimeOriginal: string | null;
  offsetTimeOriginal: string | null;
  decLat: number | null;
  decLng: number | null;
  gpsUtcMs: number | null;
};

export type SubDir = { name: string; imageCount: number };

export type FolderListing = {
  path: string;
  parent: string | null;
  subdirs: SubDir[];
  photos: GeotagPhoto[];
};

const countImages = (dir: string): number => {
  try {
    return fs.readdirSync(dir).filter(isImage).length;
  } catch {
    return 0;
  }
};

export const gpsFixUtcMs = (exif: Record<string, unknown>): number | null => {
  const stamp = exif.GPSDateStamp;
  const time = exif.GPSTimeStamp;
  if (!stamp || !Array.isArray(time) || time.length < 3) return null;
  const match = /(\d{4})\D(\d{1,2})\D(\d{1,2})/.exec(String(stamp));
  if (!match) return null;
  const ms = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Math.floor(Number(time[0])),
    Math.floor(Number(time[1])),
    Math.floor(Number(time[2])),
  );
  return Number.isFinite(ms) ? ms : null;
};

const readPhoto = async (filepath: string, filename: string): Promise<GeotagPhoto> => {
  // Mirror src/services/photo.ts: reviveValues + read local getters so the
  // camera wall-clock is preserved without a timezone shift.
  const exif = ((await exifr
    .parse(filepath, { reviveValues: true })
    .catch(() => null)) ?? {}) as Record<string, unknown>;

  const original = exif.DateTimeOriginal;
  const dateTimeOriginal =
    original instanceof Date
      ? dateToNaiveIso(original)
      : typeof original === "string"
        ? original
        : null;

  const { decLat, decLng } = getDegLatLngFromExif(exif);

  return {
    filename,
    path: filepath,
    dateTimeOriginal,
    offsetTimeOriginal: (exif.OffsetTimeOriginal as string) ?? (exif.OffsetTime as string) ?? null,
    decLat,
    decLng,
    gpsUtcMs: gpsFixUtcMs(exif),
  };
};

/** List a directory: its sub-directories (with image counts) and its own photos. */
export const listFolder = async (requested?: string): Promise<FolderListing> => {
  const dir = requested ? path.resolve(requested) : DEFAULT_ROOT;
  const stat = fs.statSync(dir); // throws (→ 404) if it doesn't exist
  if (!stat.isDirectory()) throw new Error("not a directory");

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const subdirs: SubDir[] = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => ({ name: e.name, imageCount: countImages(path.join(dir, e.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const imageFiles = entries
    .filter((e) => e.isFile() && isImage(e.name))
    .map((e) => e.name)
    .sort();

  const photos: GeotagPhoto[] = [];
  for (const filename of imageFiles) {
    photos.push(await readPhoto(path.join(dir, filename), filename));
  }

  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, subdirs, photos };
};

/** Is `p` an existing image file? (thumbnail guard.) */
export const isImageFile = (p: string): boolean => {
  try {
    return isImage(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
