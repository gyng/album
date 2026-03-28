/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OPTIMISED_VIDEO_MAX_WIDTH,
  RESIZED_VIDEO_DIR,
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

});
