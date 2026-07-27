import fs from "node:fs";
import path from "path";
import { spawn } from "node:child_process";
import type { Buffer } from "node:buffer";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import { stripPublicFromPath } from "./photo";
import { encodePublicAssetPath } from "../util/encodePublicAssetPath";
import imageOptimisationConfig from "./imageOptimisationConfig.json";
import { posterPathsFor, readVideoPosterSidecar } from "./videoPoster";
import type { OptimisedPhoto } from "./types";

export const OPTIMISED_VIDEO_MAX_WIDTH = 1920;
export const OPTIMISED_VIDEO_PRESET = "medium";
export const OPTIMISED_VIDEO_CRF = 30;
export const OPTIMISED_VIDEO_AUDIO_BITRATE = "96k";
export const VIDEO_VALIDATION_SECONDS = "0.25";
export const VIDEO_VALIDATION_TIMEOUT_MS = 4000;
export const RESIZED_VIDEO_DIR = ".resized_videos";
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"];

export type OptimisedVideo = {
  src: string;
  mimeType: "video/mp4";
};

export type OriginalVideoTechnicalData = {
  originalDate?: string;
  codec?: string;
  profile?: string;
  fps?: number;
  bitrateKbps?: number;
  fileSizeBytes?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  audioCodec?: string;
  container?: string;
};

const parseOriginalDate = (raw?: string): string | undefined => {
  if (!raw) {
    return undefined;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) {
    return undefined;
  }
  return parsed.toISOString();
};

const parseFps = (raw?: string): number | undefined => {
  if (!raw || !raw.includes("/")) {
    return undefined;
  }
  const [numRaw, denRaw] = raw.split("/");
  const num = Number(numRaw);
  const den = Number(denRaw);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return undefined;
  }
  return Number((num / den).toFixed(3));
};

export const isVideoFile = (filepath: string): boolean => {
  return VIDEO_EXTENSIONS.includes(path.extname(filepath).toLowerCase());
};

// Drop keys whose value is `undefined`. Next's isSerializableProps aborts the
// static build on any explicit `undefined` in page props, and this object is
// serialised into album-page props, so we omit absent fields rather than
// setting them to `undefined` (matching the "omit optional props" convention).
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
  // The loop above drops every `undefined`, so no present key holds `undefined`.
  return result as { [K in keyof T]?: Exclude<T[K], undefined> };
};

type FfprobeResult = {
  streams?: Array<any>;
  format?: any;
};

// Pure mapper from a parsed ffprobe payload to serialisable technical data.
// Exported for unit testing with fabricated metadata (e.g. missing
// creation_time / bit_rate) without spawning ffprobe.
export const buildOriginalVideoTechnicalData = (
  parsed: FfprobeResult,
  fileSizeBytes?: number,
): OriginalVideoTechnicalData => {
  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === "video") ?? {};
  const audioStream = streams.find((s) => s.codec_type === "audio") ?? {};
  const format = parsed.format ?? {};

  const originalDate = parseOriginalDate(
    videoStream?.tags?.creation_time ?? format?.tags?.creation_time,
  );
  const bitrateRaw = videoStream.bit_rate ?? format.bit_rate;
  const durationRaw = videoStream.duration ?? format.duration;

  return omitUndefined({
    originalDate,
    codec: videoStream.codec_name,
    profile: videoStream.profile,
    fps: parseFps(videoStream.avg_frame_rate ?? videoStream.r_frame_rate),
    bitrateKbps: bitrateRaw ? Math.round(Number(bitrateRaw) / 1000) : undefined,
    fileSizeBytes,
    durationSeconds: durationRaw ? Number(Number(durationRaw).toFixed(3)) : undefined,
    width: videoStream.width ? Number(videoStream.width) : undefined,
    height: videoStream.height ? Number(videoStream.height) : undefined,
    audioCodec: audioStream.codec_name,
    container: format.format_name,
  });
};

const runFfmpeg = async (args: string[]): Promise<void> => {
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary is unavailable");
  }
  const ffmpegExecutable = ffmpegPath;

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegExecutable, args, { stdio: "pipe" });
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += String(chunk);
    });

    proc.on("error", (err: Error) => {
      reject(err);
    });

    proc.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg failed with code ${code}: ${stderr}`));
    });
  });
};

const isValidCachedVideo = async (videoPath: string): Promise<boolean> => {
  if (process.env.NODE_ENV === "test") {
    return true;
  }

  if (!ffmpegPath) {
    return false;
  }

  const ffmpegExecutable = ffmpegPath;

  return new Promise((resolve) => {
    const proc = spawn(
      ffmpegExecutable,
      [
        "-v",
        "error",
        "-ss",
        "0",
        "-t",
        VIDEO_VALIDATION_SECONDS,
        "-i",
        videoPath,
        "-map",
        "0:v:0",
        "-f",
        "null",
        "-",
      ],
      { stdio: "pipe" },
    );

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve(false);
    }, VIDEO_VALIDATION_TIMEOUT_MS);

    proc.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });

    proc.on("close", (code: number | null) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
};

export const getOriginalVideoTechnicalData = async (
  videoPath: string,
): Promise<OriginalVideoTechnicalData> => {
  if (!ffprobePath.path) {
    return {};
  }

  const ffprobeExecutable = ffprobePath.path;

  return new Promise((resolve) => {
    const proc = spawn(
      ffprobeExecutable,
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", videoPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += String(chunk);
    });

    proc.on("error", () => {
      resolve({});
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as FfprobeResult;
        const stat = fs.existsSync(videoPath) ? fs.statSync(videoPath) : null;
        resolve(buildOriginalVideoTechnicalData(parsed, stat?.size));
      } catch {
        resolve({});
      }
    });
  });
};

// stripPublicFromPath drops the first path segment, which is only correct for
// the build's own relative "public/data/..." paths. Poster variants are located
// from an injectable public directory (absolute in tests, and potentially
// absolute for a caller outside src/), so anchor on the "public" segment
// itself. Encoding stays a single pass, as every asset URL builder must.
const toPublicAssetUrl = (filePath: string): string => {
  const parts = filePath.split(path.sep);
  const publicIndex = parts.lastIndexOf("public");
  const relative = publicIndex === -1 ? parts.slice(1) : parts.slice(publicIndex + 1);
  return encodePublicAssetPath(`/${relative.join("/")}`);
};

export type VideoPoster = {
  srcset: OptimisedPhoto[];
  capturedAtLocal?: string;
  latDeg?: number;
  lngDeg?: number;
  durationSeconds?: number;
};

/**
 * Read the poster `npm run prepare:posters` extracted for a clip. Read-only by
 * design: extraction is a prepass so that the indexer (which runs before the
 * build) sees the same frames the site does, and so one missing poster cannot
 * turn a page build into an ffmpeg run.
 */
export const readVideoPoster = (
  videoPath: string,
  publicAlbumsDir = "public/data/albums",
): VideoPoster | null => {
  const paths = posterPathsFor(videoPath, publicAlbumsDir);
  const sidecar = readVideoPosterSidecar(paths.sidecar);
  if (!sidecar) {
    return null;
  }

  const aspectRatio = sidecar.width && sidecar.height ? sidecar.height / sidecar.width : undefined;

  const srcset = imageOptimisationConfig.sizes
    .slice()
    .sort((a, b) => a - b)
    .flatMap((size): OptimisedPhoto[] => {
      const variant = paths.variantFor(size);
      if (!fs.existsSync(variant)) {
        return [];
      }
      return [
        {
          src: toPublicAssetUrl(variant),
          width: size,
          height: aspectRatio ? Math.round(size * aspectRatio) : size,
        },
      ];
    });

  if (srcset.length === 0) {
    return null;
  }

  return omitUndefined({
    srcset,
    capturedAtLocal: sidecar.capturedAtLocal,
    latDeg: sidecar.latDeg,
    lngDeg: sidecar.lngDeg,
    durationSeconds: sidecar.durationSeconds,
  }) as VideoPoster;
};

export const optimiseVideo = async (
  videoPath: string,
  outputDirectory: string,
): Promise<OptimisedVideo> => {
  const filename = path.basename(videoPath);
  const dirname = path.dirname(videoPath);
  const albumName = path.basename(dirname);
  const publicAlbumDirectory = path.join(outputDirectory, albumName);

  const outputFile = path.join(
    publicAlbumDirectory,
    RESIZED_VIDEO_DIR,
    `${filename}@${OPTIMISED_VIDEO_MAX_WIDTH}.mp4`,
  );

  fs.mkdirSync(path.join(publicAlbumDirectory, RESIZED_VIDEO_DIR), {
    recursive: true,
  });

  if (fs.existsSync(outputFile) && fs.statSync(outputFile).size > 0) {
    const isValidCached = await isValidCachedVideo(outputFile);

    if (isValidCached) {
      return {
        src: encodePublicAssetPath(stripPublicFromPath(outputFile)),
        mimeType: "video/mp4",
      };
    }

    console.log(`Detected corrupt cached video: ${outputFile}`);
    console.log(`Cached optimised video is invalid, re-encoding: ${outputFile}`);
    fs.unlinkSync(outputFile);
  }

  console.log(`Optimising video with ffmpeg: ${videoPath} -> ${outputFile}`);

  const ffmpegArgs = [
    "-y",
    "-i",
    videoPath,
    "-vf",
    `scale='min(${OPTIMISED_VIDEO_MAX_WIDTH},iw)':-2`,
    "-c:v",
    "libx264",
    "-tag:v",
    "avc1",
    "-preset",
    OPTIMISED_VIDEO_PRESET,
    "-crf",
    String(OPTIMISED_VIDEO_CRF),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    OPTIMISED_VIDEO_AUDIO_BITRATE,
    "-ac",
    "2",
    "-ar",
    "48000",
    outputFile,
  ];

  await runFfmpeg(ffmpegArgs);

  if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
    throw new Error(`ffmpeg produced empty output for ${videoPath}`);
  }

  console.log(`Optimised video ready: ${outputFile}`);

  return {
    src: encodePublicAssetPath(stripPublicFromPath(outputFile)),
    mimeType: "video/mp4",
  };
};
