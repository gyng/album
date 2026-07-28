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
  readVideoPoster,
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
      src: `/${cachedOutput.split(path.sep).slice(1).join(path.sep)}`.replace(
        "@1920.mp4",
        "%401920.mp4",
      ),
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

describe("readVideoPoster", () => {
  const buildAlbum = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-video-poster-"));
    const albumDir = path.join(root, "albums", "trip");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const videoCacheDir = path.join(publicAlbumsDir, "trip", ".resized_videos");
    const imageCacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(videoCacheDir, { recursive: true });
    fs.mkdirSync(imageCacheDir, { recursive: true });
    const video = path.join(albumDir, "clip.mov");
    fs.writeFileSync(video, "video");
    return { root, video, publicAlbumsDir, videoCacheDir, imageCacheDir };
  };

  it("returns the variants that exist alongside the clip's recorded metadata", () => {
    const { video, publicAlbumsDir, videoCacheDir, imageCacheDir } = buildAlbum();
    fs.writeFileSync(
      path.join(videoCacheDir, "clip.mov@poster.json"),
      JSON.stringify({
        mediaKind: "video",
        capturedAtLocal: "2026-02-27T10:52:10",
        latDeg: 35.6895,
        lngDeg: 139.6917,
        durationSeconds: 13.013,
        width: 3840,
        height: 2160,
      }),
    );
    // Only two of the three configured sizes were encoded; a poster must
    // never advertise a variant that is not on disk.
    fs.writeFileSync(path.join(imageCacheDir, "clip.mov@800.avif"), "avif");
    fs.writeFileSync(path.join(imageCacheDir, "clip.mov@1600.avif"), "avif");

    const poster = readVideoPoster(video, publicAlbumsDir);

    expect(poster?.capturedAtLocal).toBe("2026-02-27T10:52:10");
    expect(poster?.latDeg).toBeCloseTo(35.6895, 4);
    expect(poster?.durationSeconds).toBeCloseTo(13.013, 3);
    expect(poster?.srcset.map((variant) => variant.src)).toEqual([
      "/data/albums/trip/.resized_images/clip.mov%40800.avif",
      "/data/albums/trip/.resized_images/clip.mov%401600.avif",
    ]);
    // Variant dimensions come from the poster's own aspect ratio, scaled to
    // the encoded width, so layout placeholders do not jump.
    expect(poster?.srcset[0]).toEqual({
      src: "/data/albums/trip/.resized_images/clip.mov%40800.avif",
      width: 800,
      height: 450,
    });
  });

  // Sidecars are written by the poster prepass, so anything malformed means a
  // truncated write or a tampered file. These values are typed as numbers and
  // travel into page props: a string latitude becomes a map pin at "north".
  it("ignores sidecar fields that are not what they claim to be", () => {
    const { video, publicAlbumsDir, videoCacheDir, imageCacheDir } = buildAlbum();
    fs.writeFileSync(path.join(imageCacheDir, "clip.mov@800.avif"), "avif");
    fs.writeFileSync(
      path.join(videoCacheDir, "clip.mov@poster.json"),
      JSON.stringify({
        mediaKind: "video",
        capturedAtLocal: 20260227,
        latDeg: "north",
        lngDeg: "east",
        durationSeconds: "long",
        width: "wide",
        height: null,
      }),
    );

    const poster = readVideoPoster(video, publicAlbumsDir);

    expect(poster?.srcset).toHaveLength(1);
    expect(poster?.latDeg).toBeUndefined();
    expect(poster?.lngDeg).toBeUndefined();
    expect(poster?.durationSeconds).toBeUndefined();
    expect(poster?.capturedAtLocal).toBeUndefined();
  });

  it("reads a sidecar that is valid JSON but not an object as no sidecar", () => {
    const { video, publicAlbumsDir, videoCacheDir, imageCacheDir } = buildAlbum();
    fs.writeFileSync(path.join(imageCacheDir, "clip.mov@800.avif"), "avif");

    for (const payload of ["[]", '"a string"', "42"]) {
      fs.writeFileSync(path.join(videoCacheDir, "clip.mov@poster.json"), payload);
      expect(readVideoPoster(video, publicAlbumsDir)).toBeNull();
    }
  });

  it("returns null when the clip has no poster yet", () => {
    const { video, publicAlbumsDir } = buildAlbum();
    expect(readVideoPoster(video, publicAlbumsDir)).toBeNull();
  });

  it("returns null when a sidecar exists but no variant was encoded", () => {
    const { video, publicAlbumsDir, videoCacheDir } = buildAlbum();
    fs.writeFileSync(
      path.join(videoCacheDir, "clip.mov@poster.json"),
      JSON.stringify({ mediaKind: "video" }),
    );
    expect(readVideoPoster(video, publicAlbumsDir)).toBeNull();
  });
});
