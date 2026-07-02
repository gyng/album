/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OPTIMISED_VIDEO_MAX_WIDTH,
  RESIZED_VIDEO_DIR,
  buildOriginalVideoTechnicalData,
  isVideoFile,
  optimiseVideo,
} from "./video";

describe("video utilities", () => {
  it("detects local video files by extension", () => {
    expect(isVideoFile("clip.mp4")).toBe(true);
    expect(isVideoFile("clip.MOV")).toBe(true);
    expect(isVideoFile("photo.jpg")).toBe(false);
  });

  it("returns cached optimized videos without using original source URL", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-video-test-"));
    const albumName = "trip";
    const albumDir = path.join(root, "albums", albumName);
    const outputDirectory = path.join(root, "public", "data", "albums");

    fs.mkdirSync(albumDir, { recursive: true });

    const localVideo = path.join(albumDir, "clip.mp4");
    fs.writeFileSync(localVideo, "video");

    const cachedOutput = path.join(
      outputDirectory,
      albumName,
      RESIZED_VIDEO_DIR,
      `clip.mp4@${OPTIMISED_VIDEO_MAX_WIDTH}.mp4`,
    );
    fs.mkdirSync(path.dirname(cachedOutput), { recursive: true });
    fs.writeFileSync(cachedOutput, "optimized-video");

    const actual = await optimiseVideo(localVideo, outputDirectory);

    expect(actual).toEqual({
      src: `/${cachedOutput.split(path.sep).slice(1).join(path.sep)}`,
      mimeType: "video/mp4",
    });
  });

  it("omits fields absent from ffprobe metadata (no undefined in SSG props)", () => {
    // A WhatsApp / screen-recording export: no creation_time, no bit_rate,
    // no duration, no profile — exactly what broke `next build` (H5).
    const parsed = {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1280,
          height: 720,
          avg_frame_rate: "30/1",
        },
      ],
      format: {
        format_name: "mov,mp4,m4a",
      },
    };

    const data = buildOriginalVideoTechnicalData(parsed);

    // Absent fields are omitted, not set to `undefined`.
    expect("originalDate" in data).toBe(false);
    expect("bitrateKbps" in data).toBe(false);
    expect("durationSeconds" in data).toBe(false);
    expect("profile" in data).toBe(false);
    expect("fileSizeBytes" in data).toBe(false);

    // Present fields survive.
    expect(data).toMatchObject({
      codec: "h264",
      width: 1280,
      height: 720,
      fps: 30,
      container: "mov,mp4,m4a",
    });

    // No value is `undefined`, and a JSON round-trip is lossless (Next's
    // isSerializableProps rejects any explicit `undefined`).
    expect(Object.values(data).some((v) => v === undefined)).toBe(false);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});
