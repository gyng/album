import fs from "node:fs";
import path from "path";
import { spawn } from "node:child_process";
import type { Buffer } from "node:buffer";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import { stripPublicFromPath } from "./photo";

export const OPTIMISED_VIDEO_MAX_WIDTH = 1920;
export const OPTIMISED_VIDEO_PRESET = "slow";
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

export const removeStaleVideos = async (dirname: string) => {
  const resizedDir = path.join(dirname, RESIZED_VIDEO_DIR);

  if (!fs.existsSync(resizedDir)) {
    console.log(
      "missing album resized video directory, skipping cleanup.",
      resizedDir,
    );
    return;
  }

  const cachedFiles = fs.readdirSync(resizedDir);

  const getOriginalFileFromCachedFilename = (cachedFilename: string) => {
    const expectedFilename = path.parse(cachedFilename).name.split("@")[0];
    const expectedOriginalFile = path.join(dirname, expectedFilename);
    return expectedOriginalFile;
  };

  return Promise.all([
    ...cachedFiles.map(async (file) => {
      const cachedFile = path.join(resizedDir, file);
      const originalFile = getOriginalFileFromCachedFilename(cachedFile);

      if (!fs.existsSync(originalFile)) {
        console.log(
          `Detected unused cached video: "${cachedFile}" (missing source "${originalFile}")`,
        );
        console.log(
          `Removing cached optimised video "${cachedFile}". Expected source "${originalFile}" to exist.`,
        );
        fs.unlinkSync(cachedFile);
      }
    }),
  ]);
};

export const removeUnneededVideoSizes = async (videoPath: string) => {
  const dirname = path.dirname(videoPath);
  const filename = path.basename(videoPath);
  const albumName = path.basename(dirname);
  const resizedDir = path.join(
    "public/data/albums",
    albumName,
    RESIZED_VIDEO_DIR,
  );

  if (!fs.existsSync(resizedDir)) {
    return;
  }

  const cachedFiles = fs.readdirSync(resizedDir);

  return Promise.all([
    ...cachedFiles.map(async (file) => {
      if (!file.startsWith(`${filename}@`) || !file.endsWith(".mp4")) {
        return;
      }

      const sizeSegment = file.split("@")[1]?.split(".")[0];
      const size = Number(sizeSegment);
      if (size !== OPTIMISED_VIDEO_MAX_WIDTH) {
        const cachedFile = path.join(resizedDir, file);
        console.log(`Detected unused cached video size: ${cachedFile}`);
        console.log(`Removing optimised video (unused size): ${cachedFile}`);
        fs.unlinkSync(cachedFile);
      }
    }),
  ]);
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
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        videoPath,
      ],
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
        const parsed = JSON.parse(stdout) as {
          streams?: Array<any>;
          format?: any;
        };
        const streams = parsed.streams ?? [];
        const videoStream = streams.find((s) => s.codec_type === "video") ?? {};
        const audioStream = streams.find((s) => s.codec_type === "audio") ?? {};
        const format = parsed.format ?? {};
        const originalDate = parseOriginalDate(
          videoStream?.tags?.creation_time ?? format?.tags?.creation_time,
        );

        const stat = fs.existsSync(videoPath) ? fs.statSync(videoPath) : null;
        const bitrateRaw = videoStream.bit_rate ?? format.bit_rate;
        const durationRaw = videoStream.duration ?? format.duration;

        resolve({
          originalDate,
          codec: videoStream.codec_name,
          profile: videoStream.profile,
          fps: parseFps(videoStream.avg_frame_rate ?? videoStream.r_frame_rate),
          bitrateKbps: bitrateRaw ? Math.round(Number(bitrateRaw) / 1000) : undefined,
          fileSizeBytes: stat?.size,
          durationSeconds: durationRaw
            ? Number(Number(durationRaw).toFixed(3))
            : undefined,
          width: videoStream.width ? Number(videoStream.width) : undefined,
          height: videoStream.height ? Number(videoStream.height) : undefined,
          audioCodec: audioStream.codec_name,
          container: format.format_name,
        });
      } catch {
        resolve({});
      }
    });
  });
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

  await removeUnneededVideoSizes(videoPath);

  if (fs.existsSync(outputFile) && fs.statSync(outputFile).size > 0) {
    const isValidCached = await isValidCachedVideo(outputFile);

    if (isValidCached) {
      return {
        src: stripPublicFromPath(outputFile),
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
    src: stripPublicFromPath(outputFile),
    mimeType: "video/mp4",
  };
};
