/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { buildVideoExportTags, ensureVideoExportMetadata } from "./videoExportMetadata";

describe("video export metadata", () => {
  it("writes UTC header dates and the original local reading with its offset", () => {
    expect(
      buildVideoExportTags({
        capturedAtLocal: "2026-11-02T00:30:00",
        tzOffset: "+09:00",
        latDeg: 33.621,
        lngDeg: 135.9519,
      }),
    ).toEqual({
      creation_time: "2026-11-01T15:30:00.000Z",
      "com.apple.quicktime.creationdate": "2026-11-02T00:30:00+09:00",
      location: "+33.62100+135.95190/",
      "com.apple.quicktime.location.ISO6709": "+33.62100+135.95190/",
    });
  });

  it("does not invent a timezone or write incomplete coordinates", () => {
    expect(buildVideoExportTags({ capturedAtLocal: "2026-11-02T00:30:00", latDeg: 33.6 })).toEqual(
      {},
    );
    expect(buildVideoExportTags({ latDeg: Number.NaN, lngDeg: 135.9 })).toEqual({});
  });

  it("keeps zero and southern/western coordinates", () => {
    expect(buildVideoExportTags({ latDeg: 0, lngDeg: -0.1 }).location).toBe("+00.00000-000.10000/");
    expect(buildVideoExportTags({ latDeg: -33.8, lngDeg: 151.2 }).location).toBe(
      "-33.80000+151.20000/",
    );
  });

  it("repairs cached MP4 dates and GPS without changing audio/video packets", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "video-export-metadata-"));
    const video = path.join(root, "clip.mp4");
    try {
      execFileSync(ffmpegPath!, [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=32x32:r=10",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        "0.2",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-timecode",
        "00:00:00:00",
        video,
      ]);
      const packets = () =>
        execFileSync(
          ffmpegPath!,
          [
            "-v",
            "error",
            "-i",
            video,
            "-map",
            "0:v",
            "-map",
            "0:a?",
            "-c",
            "copy",
            "-f",
            "streamhash",
            "-hash",
            "sha256",
            "-",
          ],
          { encoding: "utf8" },
        );
      const probe = () =>
        JSON.parse(
          execFileSync(
            ffprobe.path!,
            ["-v", "quiet", "-show_format", "-show_streams", "-of", "json", video],
            { encoding: "utf8" },
          ),
        );
      const originalPackets = packets();
      expect(
        probe().streams.some((stream: { codec_type: string }) => stream.codec_type === "data"),
      ).toBe(true);
      const capture = {
        capturedAtLocal: "2026-11-02T22:18:00",
        tzOffset: "+09:00",
        latDeg: 33.621,
        lngDeg: 135.9519,
      };
      await ensureVideoExportMetadata(video, capture);
      const result = probe();
      expect(Date.parse(result.format.tags.creation_time)).toBe(Date.parse("2026-11-02T13:18:00Z"));
      for (const stream of result.streams) {
        expect(Date.parse(stream.tags.creation_time)).toBe(Date.parse("2026-11-02T13:18:00Z"));
      }
      expect(result.format.tags["com.apple.quicktime.creationdate"]).toBe(
        "2026-11-02T22:18:00+09:00",
      );
      expect(result.format.tags["com.apple.quicktime.location.ISO6709"]).toBe(
        "+33.62100+135.95190/",
      );
      expect(packets()).toBe(originalPackets);

      // Numeric equality must not bypass repair of a representation Google
      // Photos ignores.
      const legacy = path.join(root, "over-precise.mp4");
      execFileSync(ffmpegPath!, [
        "-v",
        "error",
        "-i",
        video,
        "-map",
        "0",
        "-c",
        "copy",
        "-map_metadata",
        "0",
        "-metadata",
        "com.apple.quicktime.location.ISO6709=+33.6210000+135.9519000/",
        "-movflags",
        "+faststart+use_metadata_tags",
        legacy,
      ]);
      fs.renameSync(legacy, video);
      expect(probe().format.tags["com.apple.quicktime.location.ISO6709"]).toBe(
        "+33.6210000+135.9519000/",
      );
      await ensureVideoExportMetadata(video, capture);
      expect(probe().format.tags["com.apple.quicktime.location.ISO6709"]).toBe(
        "+33.62100+135.95190/",
      );
      expect(packets()).toBe(originalPackets);

      await ensureVideoExportMetadata(video, {
        ...capture,
        latDeg: 34.4813461,
        lngDeg: 136.8461511,
      });
      expect(probe().format.tags["com.apple.quicktime.location.ISO6709"]).toBe(
        "+34.48135+136.84615/",
      );
      expect(packets()).toBe(originalPackets);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
