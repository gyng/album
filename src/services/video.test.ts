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
  removeStaleVideos,
  removeUnneededVideoSizes,
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

  it("removes stale cached videos whose originals no longer exist", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-video-cleanup-"));
    const resizedDir = path.join(root, RESIZED_VIDEO_DIR);
    fs.mkdirSync(resizedDir, { recursive: true });

    const staleCached = path.join(
      resizedDir,
      `missing.mp4@${OPTIMISED_VIDEO_MAX_WIDTH}.mp4`,
    );
    const validCached = path.join(
      resizedDir,
      `existing.mp4@${OPTIMISED_VIDEO_MAX_WIDTH}.mp4`,
    );
    const validOriginal = path.join(root, "existing.mp4");

    fs.writeFileSync(staleCached, "stale");
    fs.writeFileSync(validCached, "valid");
    fs.writeFileSync(validOriginal, "original");

    await removeStaleVideos(root);

    expect(fs.existsSync(staleCached)).toBe(false);
    expect(fs.existsSync(validCached)).toBe(true);
  });

  it("removes outdated cached size variants", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-video-size-"));
    const cwdBefore = process.cwd();
    process.chdir(root);

    try {
      const albumName = "trip";
      const sourceDir = path.join(root, "albums", albumName);
      const outputDir = path.join(
        root,
        "public",
        "data",
        "albums",
        albumName,
        RESIZED_VIDEO_DIR,
      );

      fs.mkdirSync(sourceDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });

      const sourceVideo = path.join(sourceDir, "clip.mp4");
      fs.writeFileSync(sourceVideo, "source");

      const oldSize = path.join(outputDir, "clip.mp4@1280.mp4");
      const targetSize = path.join(
        outputDir,
        `clip.mp4@${OPTIMISED_VIDEO_MAX_WIDTH}.mp4`,
      );
      fs.writeFileSync(oldSize, "old");
      fs.writeFileSync(targetSize, "target");

      await removeUnneededVideoSizes(sourceVideo);

      expect(fs.existsSync(oldSize)).toBe(false);
      expect(fs.existsSync(targetSize)).toBe(true);
    } finally {
      process.chdir(cwdBefore);
    }
  });
});
