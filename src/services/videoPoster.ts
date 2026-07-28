/**
 * Poster frames for local videos.
 *
 * A video has no pixels anything else in this repo can read: the indexer wants
 * a still to caption, embed and colour-sample, the search tiles and map markers
 * want a thumbnail, and the album page wants something on screen before play.
 * One extracted frame serves all of them.
 *
 * The display variants are deliberately written into the album's own
 * `.resized_images` directory under the *video's* filename, so every existing
 * `/data/albums/<album>/.resized_images/<file>@<size>.avif` URL builder
 * addresses a video's poster without knowing that videos exist. The full-size
 * JPEG the indexer reads, and the sidecar describing the clip, live with the
 * transcoded MP4 in `.resized_videos` because nothing serves them to a browser.
 *
 * This module is required directly from `bin/prepare-optimised-images.cjs`
 * through Node's TypeScript stripping, so it must keep no relative imports and
 * no JSON imports — encoder settings are injected by the caller instead.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Buffer } from "node:buffer";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import sharp from "sharp";

export const RESIZED_IMAGE_DIR = ".resized_images";
export const RESIZED_VIDEO_DIR = ".resized_videos";
export const POSTER_SOURCE_SUFFIX = "@poster.jpg";
export const POSTER_SIDECAR_SUFFIX = "@poster.json";
/** Width of the extracted JPEG the indexer reads. */
export const POSTER_SOURCE_WIDTH = 3200;
/**
 * Fractions of the clip sampled as poster candidates. A single fixed seek is
 * a coin toss — the committed night-time fixture opens on an almost entirely
 * black frame — so several cheap keyframe seeks are scored against each other
 * and the most informative frame wins.
 */
export const POSTER_CANDIDATE_FRACTIONS = [0.1, 0.3, 0.5, 0.7];

export type VideoPosterMetadata = {
  capturedAtLocal?: string;
  timeSource?: "quicktime-creationdate" | "creation_time";
  latDeg?: number;
  lngDeg?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
};

export type VideoPosterSidecar = VideoPosterMetadata & {
  mediaKind: "video";
  /** Offsets, in seconds, of the per-minute frames extracted from this clip. */
  scenes?: number[];
  /** Album-relative source path, matching the indexer's `../albums/...` keys. */
  sourcePath?: string;
  source?: { mtimeMs: number; size: number };
};

type FfprobeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
  tags?: Record<string, string>;
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
};

type FfprobePayload = {
  streams?: FfprobeStream[];
  format?: { duration?: string; tags?: Record<string, string> };
};

const omitUndefined = <T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } => {
  const result: Partial<T> = {};
  (Object.keys(obj) as Array<keyof T>).forEach((key) => {
    const value = obj[key];
    if (value !== undefined) {
      result[key] = value;
    }
  });
  return result as { [K in keyof T]?: Exclude<T[K], undefined> };
};

// ISO 6709, as written into `location` / `com.apple.quicktime.location.ISO6709`:
// a signed latitude immediately followed by a signed longitude, optionally an
// altitude, then "/". Values are usually decimal degrees but the standard also
// allows degrees-and-minutes (DDMM.MM), which only reveals itself by producing
// an impossible latitude.
export const parseIso6709Location = (
  raw: string | undefined,
): { latDeg: number; lngDeg: number } | undefined => {
  if (!raw) {
    return undefined;
  }

  const match = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(raw.trim());
  if (!match) {
    return undefined;
  }

  let latDeg = Number(match[1]);
  let lngDeg = Number(match[2]);
  if (!Number.isFinite(latDeg) || !Number.isFinite(lngDeg)) {
    return undefined;
  }

  if (Math.abs(latDeg) > 90 || Math.abs(lngDeg) > 180) {
    const fromDegreesMinutes = (value: number): number => {
      const sign = value < 0 ? -1 : 1;
      const magnitude = Math.abs(value);
      const degrees = Math.trunc(magnitude / 100);
      return sign * (degrees + (magnitude - degrees * 100) / 60);
    };
    latDeg = fromDegreesMinutes(latDeg);
    lngDeg = fromDegreesMinutes(lngDeg);
  }

  if (Math.abs(latDeg) > 90 || Math.abs(lngDeg) > 180) {
    return undefined;
  }

  return { latDeg, lngDeg };
};

// Camera-local wall clock with no zone, matching how EXIF timestamps are stored
// end to end. QuickTime's `creation_time` is stamped "Z" by cameras that are in
// fact writing local time (the committed X-T5 fixture does), and Apple's own tag
// carries an offset that only names the zone its wall clock is already in — so
// in both cases the reading is kept as written and the zone marker dropped.
const toNaiveLocalIso = (raw: string | undefined): string | undefined => {
  if (!raw) {
    return undefined;
  }
  const match = /^(\d{4})[-:](\d{2})[-:](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
};

const readRotation = (stream: FfprobeStream): number => {
  const fromSideData = stream.side_data_list?.find(
    (entry) => entry.side_data_type === "Display Matrix",
  )?.rotation;
  const fromTag = stream.tags?.rotate;
  const rotation = fromSideData ?? (fromTag !== undefined ? Number(fromTag) : undefined);
  return Number.isFinite(rotation) ? (rotation as number) : 0;
};

export const buildVideoPosterMetadata = (probe: FfprobePayload): VideoPosterMetadata => {
  const streams = probe.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === "video") ?? {};
  const formatTags = probe.format?.tags ?? {};
  const streamTags = videoStream.tags ?? {};

  const quickTimeDate = toNaiveLocalIso(
    formatTags["com.apple.quicktime.creationdate"] ??
      streamTags["com.apple.quicktime.creationdate"],
  );
  const creationTime = toNaiveLocalIso(formatTags.creation_time ?? streamTags.creation_time);
  const capturedAtLocal = quickTimeDate ?? creationTime;
  const timeSource = quickTimeDate
    ? ("quicktime-creationdate" as const)
    : creationTime
      ? ("creation_time" as const)
      : undefined;

  const location = parseIso6709Location(
    formatTags.location ??
      formatTags["com.apple.quicktime.location.ISO6709"] ??
      streamTags.location ??
      streamTags["com.apple.quicktime.location.ISO6709"],
  );

  const durationRaw = videoStream.duration ?? probe.format?.duration;
  const durationSeconds =
    durationRaw !== undefined && Number.isFinite(Number(durationRaw))
      ? Number(Number(durationRaw).toFixed(3))
      : undefined;

  // The extracted frame comes out upright, so a quarter-turn display matrix
  // means the stored dimensions are the wrong way round for the poster.
  const quarterTurned = Math.abs(readRotation(videoStream)) % 180 === 90;
  const width = quarterTurned ? videoStream.height : videoStream.width;
  const height = quarterTurned ? videoStream.width : videoStream.height;

  return omitUndefined({
    capturedAtLocal,
    timeSource,
    latDeg: location?.latDeg,
    lngDeg: location?.lngDeg,
    durationSeconds,
    width,
    height,
  });
};

export const posterSeekSeconds = (
  durationSeconds: number | undefined,
  fractions: number[] = POSTER_CANDIDATE_FRACTIONS,
): number[] => {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [0];
  }
  return fractions.map((fraction) => Number((durationSeconds * fraction).toFixed(3)));
};

/**
 * How much of a poster a frame is. Tonal spread (the standard deviation of the
 * greyscale histogram) stands in for "there is something to look at", and a
 * frame whose average is pinned to either end of the range — a fade, a lens
 * cap, a blown sky — is discounted rather than excluded, so that a genuinely
 * dark clip still picks its least-bad frame instead of its first.
 */
export const scorePosterFrame = ({ mean, stdev }: { mean: number; stdev: number }): number => {
  const distanceFromMidtone = Math.abs(mean - 128) / 128;
  const exposurePenalty = Math.max(0.05, 1 - distanceFromMidtone ** 3);
  return stdev * exposurePenalty;
};

/** One frame a minute, which is what makes a moment inside a clip findable. */
export const SCENE_INTERVAL_SECONDS = 60;
/**
 * Ceiling on scenes per clip. Per-minute is linear, so an hour of footage would
 * otherwise mean an hour's worth of embeddings and thumbnails; past the cap the
 * interval stretches so a clip of any length costs a bounded amount.
 */
export const SCENE_MAX_PER_VIDEO = 60;
/** A frame this close to the end is a fade or a hand reaching for the camera. */
const SCENE_END_MARGIN_SECONDS = 5;

export const sceneSeconds = (
  durationSeconds: number | undefined,
  {
    interval = SCENE_INTERVAL_SECONDS,
    max = SCENE_MAX_PER_VIDEO,
  }: { interval?: number; max?: number } = {},
): number[] => {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [];
  }

  const usable = durationSeconds - SCENE_END_MARGIN_SECONDS;
  const spacing = Math.max(interval, durationSeconds / (max + 1));
  const scenes: number[] = [];
  // Multiplied rather than accumulated: adding a rounded spacing sixty times
  // drifts, and the offsets are what name the cache files.
  for (let index = 1; scenes.length < max; index += 1) {
    const at = spacing * index;
    if (at >= usable) {
      break;
    }
    scenes.push(Number(at.toFixed(3)));
  }
  return scenes;
};

/** Cache name for a scene: the clip's own name plus the moment it came from. */
export const sceneFilename = (filename: string, seconds: number): string =>
  `${filename}@t${Math.round(seconds)}`;

export type VideoPosterPaths = {
  albumName: string;
  filename: string;
  posterSource: string;
  sidecar: string;
  variantDirectory: string;
  variantFor: (size: number) => string;
};

export const posterPathsFor = (videoPath: string, publicAlbumsDir: string): VideoPosterPaths => {
  const filename = path.basename(videoPath);
  const albumName = path.basename(path.dirname(videoPath));
  const albumPublicDir = path.join(publicAlbumsDir, albumName);
  const videoCacheDir = path.join(albumPublicDir, RESIZED_VIDEO_DIR);
  const variantDirectory = path.join(albumPublicDir, RESIZED_IMAGE_DIR);

  return {
    albumName,
    filename,
    posterSource: path.join(videoCacheDir, `${filename}${POSTER_SOURCE_SUFFIX}`),
    sidecar: path.join(videoCacheDir, `${filename}${POSTER_SIDECAR_SUFFIX}`),
    variantDirectory,
    variantFor: (size: number) => path.join(variantDirectory, `${filename}@${size}.avif`),
  };
};

/**
 * Where a scene's frame and display variants live. Named for the clip plus the
 * moment, so one `@<size>.avif` URL builder still addresses them and the cache
 * sweep can trace each entry back to the video it belongs to.
 */
export const scenePosterPathsFor = (
  videoPath: string,
  seconds: number,
  publicAlbumsDir: string,
): VideoPosterPaths => {
  const base = posterPathsFor(videoPath, publicAlbumsDir);
  const filename = sceneFilename(base.filename, seconds);
  const videoCacheDir = path.dirname(base.posterSource);

  return {
    albumName: base.albumName,
    filename,
    posterSource: path.join(videoCacheDir, `${filename}${POSTER_SOURCE_SUFFIX}`),
    sidecar: path.join(videoCacheDir, `${filename}${POSTER_SIDECAR_SUFFIX}`),
    variantDirectory: base.variantDirectory,
    variantFor: (size: number) => path.join(base.variantDirectory, `${filename}@${size}.avif`),
  };
};

export const readVideoPosterSidecar = (sidecarPath: string): VideoPosterSidecar | null => {
  try {
    return JSON.parse(fs.readFileSync(sidecarPath, "utf-8")) as VideoPosterSidecar;
  } catch {
    return null;
  }
};

export const probeVideo = async (videoPath: string): Promise<FfprobePayload> => {
  const executable = ffprobeStatic.path;
  if (!executable) {
    return {};
  }

  return new Promise((resolve) => {
    const proc = spawn(
      executable,
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", videoPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += String(chunk);
    });
    proc.on("error", () => resolve({}));
    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(stdout) as FfprobePayload);
      } catch {
        resolve({});
      }
    });
  });
};

const runFfmpeg = (args: string[]): Promise<void> => {
  if (!ffmpegPath) {
    return Promise.reject(new Error("ffmpeg binary is unavailable"));
  }
  const executable = ffmpegPath;

  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, { stdio: "pipe" });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += String(chunk);
    });
    proc.on("error", reject);
    proc.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg failed with code ${code}: ${stderr}`));
    });
  });
};

// Same discipline as the image cache: a non-empty file is not proof of a good
// file, so a cached poster only counts once sharp decodes real dimensions out
// of it. An encoder that reports success while writing garbage has shipped here
// before (see prepare-optimised-images.cjs).
const isDecodableFile = async (target: string): Promise<boolean> => {
  try {
    if (fs.statSync(target).size === 0) {
      return false;
    }
    const metadata = await sharp(target).metadata();
    return Boolean(metadata.width && metadata.height);
  } catch {
    return false;
  }
};

/**
 * Extract one frame at a given offset into `target`, returning false when the
 * clip has nothing there (a seek past the last keyframe of a truncated file).
 */
const extractFrame = async (
  videoPath: string,
  seconds: number,
  target: string,
): Promise<boolean> => {
  const temp = `${target}.tmp-${process.pid}`;
  try {
    await runFfmpeg([
      "-y",
      "-ss",
      String(seconds),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      `scale='min(${POSTER_SOURCE_WIDTH},iw)':-2`,
      "-q:v",
      "3",
      "-f",
      "image2",
      temp,
    ]);
  } catch {
    fs.rmSync(temp, { force: true });
    return false;
  }

  if (!(await isDecodableFile(temp))) {
    fs.rmSync(temp, { force: true });
    return false;
  }

  fs.renameSync(temp, target);
  return true;
};

const encodeVariants = async (
  paths: VideoPosterPaths,
  { sizes, avif }: { sizes: number[]; avif: Record<string, unknown> },
  force: boolean,
): Promise<number> => {
  fs.mkdirSync(paths.variantDirectory, { recursive: true });
  let encoded = 0;
  for (const size of sizes) {
    const target = paths.variantFor(size);
    if (!force && (await isDecodableFile(target))) {
      continue;
    }
    const temp = `${target}.tmp-${process.pid}`;
    await sharp(paths.posterSource)
      .resize({ width: size, withoutEnlargement: true })
      .avif(avif)
      .toFile(temp);
    if (!(await isDecodableFile(temp))) {
      fs.rmSync(temp, { force: true });
      throw new Error(`Poster variant ${target} was written but is not decodable`);
    }
    fs.renameSync(temp, target);
    encoded += 1;
  }
  return encoded;
};

export type EnsurePosterOptions = {
  publicAlbumsDir: string;
  sizes: number[];
  avif: Record<string, unknown>;
  force?: boolean;
  /** Overrides the sampled candidate positions; mainly for tests. */
  candidateFractions?: number[];
  /** Seconds between scene frames; defaults to one a minute. */
  sceneInterval?: number;
  /** Ceiling on scenes per clip, past which the interval stretches. */
  sceneMax?: number;
};

export type EnsurePosterResult = {
  paths: VideoPosterPaths;
  sidecar: VideoPosterSidecar;
  extracted: boolean;
  variantsEncoded: number;
  /** Offsets of the per-minute frames that exist for this clip. */
  scenes: number[];
};

/**
 * Delete the frames of scenes this clip no longer has.
 *
 * A clip re-exported shorter, or a change to the interval or the cap, leaves
 * frames on disk for moments that do not exist any more. Nothing else can
 * collect them: the cache sweep traces each back to a clip that is still there
 * and keeps it, and every orphan ships in the deploy. The clip's own poster is
 * never a scene, so it is never in scope here.
 */
const collectRetiredScenes = (paths: VideoPosterPaths, scenes: number[], sizes: number[]): void => {
  const wanted = new Set(scenes.map((seconds) => sceneFilename(paths.filename, seconds)));
  const scenePattern = new RegExp(`^${escapeForRegExp(paths.filename)}@t\\d+(?:\\.\\d+)?(?=@)`);

  const sweep = (directory: string) => {
    let entries: string[];
    try {
      entries = fs.readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      const match = scenePattern.exec(entry);
      if (!match || wanted.has(match[0])) {
        continue;
      }
      fs.rmSync(path.join(directory, entry), { force: true });
    }
  };

  sweep(path.dirname(paths.posterSource));
  if (sizes.length > 0) {
    sweep(paths.variantDirectory);
  }
};

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const arraysMatch = (left: number[] | undefined, right: number[]): boolean =>
  (left ?? []).length === right.length && (left ?? []).every((value, i) => value === right[i]);

/**
 * Extract (or reuse) a video's poster frame, encode the display variants, and
 * write the sidecar the indexer reads. Safe to call repeatedly: work is skipped
 * when the cached outputs are present, decodable, and newer than the source.
 */
export const ensureVideoPoster = async (
  videoPath: string,
  options: EnsurePosterOptions,
): Promise<EnsurePosterResult> => {
  const paths = posterPathsFor(videoPath, options.publicAlbumsDir);
  const stat = fs.statSync(videoPath);
  const cachedSidecar = readVideoPosterSidecar(paths.sidecar);
  const sourceUnchanged =
    !options.force &&
    cachedSidecar?.source?.size === stat.size &&
    cachedSidecar?.source?.mtimeMs === Math.round(stat.mtimeMs);

  const posterUsable = sourceUnchanged && (await isDecodableFile(paths.posterSource));

  let sidecar = cachedSidecar;
  let extracted = false;

  if (!posterUsable) {
    const probe = await probeVideo(videoPath);
    const metadata = buildVideoPosterMetadata(probe);

    fs.mkdirSync(path.dirname(paths.posterSource), { recursive: true });

    let best: { temp: string; score: number } | null = null;
    const seeks = posterSeekSeconds(metadata.durationSeconds, options.candidateFractions);
    for (const [index, seek] of seeks.entries()) {
      const temp = `${paths.posterSource}.tmp-${process.pid}-${index}`;
      try {
        await runFfmpeg([
          "-y",
          // Seeking before -i keeps this a fast keyframe seek rather than a
          // decode of every frame up to the candidate.
          "-ss",
          String(seek),
          "-i",
          videoPath,
          "-frames:v",
          "1",
          "-vf",
          `scale='min(${POSTER_SOURCE_WIDTH},iw)':-2`,
          "-q:v",
          "3",
          "-f",
          "image2",
          temp,
        ]);
      } catch {
        // A seek past the last keyframe of a short or truncated clip produces
        // no frame at all; the remaining candidates still stand.
        fs.rmSync(temp, { force: true });
        continue;
      }

      if (!(await isDecodableFile(temp))) {
        fs.rmSync(temp, { force: true });
        continue;
      }

      const channel = (await sharp(temp).greyscale().stats()).channels[0];
      const score = channel
        ? scorePosterFrame({ mean: channel.mean, stdev: channel.stdev })
        : Number.NEGATIVE_INFINITY;
      if (best && best.score >= score) {
        fs.rmSync(temp, { force: true });
        continue;
      }
      if (best) {
        fs.rmSync(best.temp, { force: true });
      }
      best = { temp, score };
    }

    if (!best) {
      throw new Error(`ffmpeg produced no readable poster frame for ${videoPath}`);
    }
    fs.renameSync(best.temp, paths.posterSource);
    extracted = true;

    sidecar = {
      mediaKind: "video",
      // Album-relative, never the build machine's path: this file lives inside
      // public/ and is served at a guessable URL, so an absolute path would
      // publish the operator's username and directory layout to anyone who
      // asked for it.
      sourcePath: `${paths.albumName}/${paths.filename}`,
      source: { mtimeMs: Math.round(stat.mtimeMs), size: stat.size },
      ...metadata,
    };
    fs.writeFileSync(paths.sidecar, `${JSON.stringify(sidecar, null, 2)}\n`);
  }

  let variantsEncoded = await encodeVariants(paths, options, extracted);

  // Per-minute scenes. The clip's own poster describes a single instant of it,
  // so a long video is otherwise unfindable past its first frame; each scene
  // becomes an embedding-only row that search can rank and link to.
  const scenes: number[] = [];
  for (const seconds of sceneSeconds(sidecar?.durationSeconds, {
    ...(options.sceneInterval !== undefined ? { interval: options.sceneInterval } : {}),
    ...(options.sceneMax !== undefined ? { max: options.sceneMax } : {}),
  })) {
    const scenePaths = scenePosterPathsFor(videoPath, seconds, options.publicAlbumsDir);
    const cached = !extracted && (await isDecodableFile(scenePaths.posterSource));
    if (!cached && !(await extractFrame(videoPath, seconds, scenePaths.posterSource))) {
      // Nothing readable there — a truncated clip whose declared duration
      // overruns its frames. The scenes around it still stand.
      continue;
    }
    scenes.push(seconds);
    variantsEncoded += await encodeVariants(scenePaths, options, !cached);
  }

  collectRetiredScenes(paths, scenes, options.sizes);

  if (sidecar && (extracted || !arraysMatch(sidecar.scenes, scenes))) {
    sidecar = { ...sidecar, ...(scenes.length > 0 ? { scenes } : {}) };
    fs.writeFileSync(paths.sidecar, `${JSON.stringify(sidecar, null, 2)}\n`);
  }

  return {
    paths,
    sidecar: sidecar ?? { mediaKind: "video" },
    extracted,
    variantsEncoded,
    scenes,
  };
};
