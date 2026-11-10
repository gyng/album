import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { exifInstantTimestamp, normaliseExifWallClockIso } from "../util/exifTime";
import { parseIso6709Location } from "./videoPoster";

export type VideoExportMetadata = {
  capturedAtLocal?: string;
  tzOffset?: string;
  latDeg?: number;
  lngDeg?: number;
};

/** MP4 headers hold a UTC instant; the Apple key retains the local clock and zone. */
export const buildVideoExportTags = (capture: VideoExportMetadata): Record<string, string> => {
  const tags: Record<string, string> = {};
  const instant = exifInstantTimestamp(capture.capturedAtLocal, capture.tzOffset);
  const wallClock = normaliseExifWallClockIso(capture.capturedAtLocal);
  if (instant !== null && wallClock) {
    tags.creation_time = new Date(instant).toISOString();
    tags["com.apple.quicktime.creationdate"] = `${wallClock}${capture.tzOffset!.trim()}`;
  }
  const { latDeg, lngDeg } = capture;
  if (
    typeof latDeg === "number" &&
    Number.isFinite(latDeg) &&
    Math.abs(latDeg) <= 90 &&
    typeof lngDeg === "number" &&
    Number.isFinite(lngDeg) &&
    Math.abs(lngDeg) <= 180
  ) {
    // Google Photos may ignore video GPS with more than five decimals:
    // https://exiftool.org/TagNames/QuickTime.html#Keys
    const coordinate = (value: number, digits: number) =>
      `${value < 0 ? "-" : "+"}${Math.abs(value)
        .toFixed(5)
        .padStart(digits + 6, "0")}`;
    const location = `${coordinate(latDeg, 2)}${coordinate(lngDeg, 3)}/`;
    tags.location = location;
    tags["com.apple.quicktime.location.ISO6709"] = location;
  }
  return tags;
};

export const videoExportFfmpegArgs = (capture: VideoExportMetadata): string[] => {
  const tags = buildVideoExportTags(capture);
  return [
    ...(tags.location ? ["-metadata", "location-eng="] : []),
    ...Object.entries(tags).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]),
    ...(tags.creation_time ? ["-metadata:s", `creation_time=${tags.creation_time}`] : []),
  ];
};

type Probe = {
  format?: { tags?: Record<string, string> };
  streams?: Array<{ tags?: Record<string, string> }>;
};

const run = promisify(execFile);
const processOptions = { encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024 } as const;
const probeMetadata = async (file: string): Promise<Probe> => {
  if (!ffprobe.path) throw new Error("ffprobe binary is unavailable");
  const { stdout } = await run(
    ffprobe.path,
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
    processOptions,
  );
  return JSON.parse(stdout) as Probe;
};

const metadataMatches = (probe: Probe, expected: Record<string, string>): boolean => {
  const actual = probe.format?.tags ?? {};
  if (expected.creation_time) {
    const instant = Date.parse(expected.creation_time);
    if (Date.parse(actual.creation_time ?? "") !== instant) return false;
    if (
      (probe.streams ?? []).some(
        (stream) => Date.parse(stream.tags?.creation_time ?? "") !== instant,
      )
    )
      return false;
    const local = actual["com.apple.quicktime.creationdate"]?.replace(
      /([+-]\d{2})(\d{2})$/,
      "$1:$2",
    );
    if (local !== expected["com.apple.quicktime.creationdate"]) return false;
  }
  if (expected.location) {
    // Repair over-precise cached coordinates even when their numbers match.
    if (
      actual["com.apple.quicktime.location.ISO6709"] !==
      expected["com.apple.quicktime.location.ISO6709"]
    )
      return false;
    const wanted = parseIso6709Location(expected.location)!;
    const matches = (raw: string | undefined, tolerance: number): boolean => {
      const location = parseIso6709Location(raw);
      return Boolean(
        location &&
        Math.abs(location.latDeg - wanted.latDeg) < tolerance &&
        Math.abs(location.lngDeg - wanted.lngDeg) < tolerance,
      );
    };
    if (!matches(actual["com.apple.quicktime.location.ISO6709"], 0.000001)) return false;
    // ffmpeg rounds the legacy location atom to four decimal places; the
    // Apple key above retains five. Both must describe the same place.
    if (actual.location && !matches(actual.location, 0.0001)) return false;
  }
  return true;
};

let temporarySequence = 0;

/** Repair existing exports by stream copy; expose the replacement only after verification. */
export const ensureVideoExportMetadata = async (
  file: string,
  capture: VideoExportMetadata,
): Promise<void> => {
  const tags = buildVideoExportTags(capture);
  if (Object.keys(tags).length === 0) return;
  if (metadataMatches(await probeMetadata(file), tags)) return;
  if (!ffmpegPath) throw new Error("ffmpeg binary is unavailable");
  const stat = fs.statSync(file);
  const temporary = `${file}.tmp-${process.pid}-${temporarySequence++}`;
  try {
    await run(
      ffmpegPath,
      [
        "-v",
        "error",
        "-y",
        "-i",
        file,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-write_tmcd",
        "0",
        "-c",
        "copy",
        "-map_metadata",
        "0",
        ...videoExportFfmpegArgs(capture),
        "-movflags",
        "+faststart+use_metadata_tags",
        "-f",
        "mp4",
        temporary,
      ],
      processOptions,
    );
    if (!metadataMatches(await probeMetadata(temporary), tags)) {
      throw new Error(`Capture metadata did not survive MP4 export: ${file}`);
    }
    fs.utimesSync(temporary, stat.atime, stat.mtime);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
};
