/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  POSTER_SIDECAR_SUFFIX,
  POSTER_SOURCE_SUFFIX,
  buildVideoPosterMetadata,
  ensureVideoPoster,
  parseIso6709Location,
  posterPathsFor,
  posterSeekSeconds,
  readVideoPosterSidecar,
  sceneSeconds,
  scenePosterPathsFor,
  scorePosterFrame,
} from "./videoPoster";

describe("parseIso6709Location", () => {
  it("reads decimal-degree coordinates written by Apple devices", () => {
    expect(parseIso6709Location("+35.6895+139.6917/")).toEqual({
      latDeg: 35.6895,
      lngDeg: 139.6917,
    });
  });

  it("ignores a trailing altitude component", () => {
    expect(parseIso6709Location("+35.6895+139.6917+044.000/")).toEqual({
      latDeg: 35.6895,
      lngDeg: 139.6917,
    });
  });

  it("keeps southern and western hemispheres negative", () => {
    expect(parseIso6709Location("-33.8688+151.2093/")).toEqual({
      latDeg: -33.8688,
      lngDeg: 151.2093,
    });
    expect(parseIso6709Location("-22.9068-43.1729/")).toEqual({
      latDeg: -22.9068,
      lngDeg: -43.1729,
    });
  });

  // Some recorders write ISO 6709 degrees-and-minutes instead of decimal
  // degrees. Read as decimal that is a latitude of 3541 degrees, so the
  // out-of-range value is the signal to re-read it as DDMM.MM.
  it("re-reads out-of-range values as degrees and minutes", () => {
    const parsed = parseIso6709Location("+3541.36+13946.10/");
    expect(parsed?.latDeg).toBeCloseTo(35.689, 3);
    expect(parsed?.lngDeg).toBeCloseTo(139.768, 3);
  });

  it("returns undefined for absent or unparseable values", () => {
    expect(parseIso6709Location(undefined)).toBeUndefined();
    expect(parseIso6709Location("")).toBeUndefined();
    expect(parseIso6709Location("somewhere nice")).toBeUndefined();
    expect(parseIso6709Location("+35.6895/")).toBeUndefined();
  });
});

describe("buildVideoPosterMetadata", () => {
  const videoStream = (tags: Record<string, string> = {}) => ({
    codec_type: "video",
    width: 3840,
    height: 2160,
    duration: "13.013000",
    tags,
  });

  // Cameras stamp QuickTime creation_time with a "Z" while writing the
  // camera's own wall clock (the committed X-T5 fixture does exactly this).
  // The whole pipeline stores camera-local wall time, so the zone marker is
  // dropped rather than applied — the same rule EXIF timestamps follow.
  it("keeps creation_time as camera-local wall clock", () => {
    const metadata = buildVideoPosterMetadata({
      streams: [videoStream()],
      format: { tags: { creation_time: "2026-02-27T10:52:10.000000Z" }, duration: "13.013000" },
    });

    expect(metadata.capturedAtLocal).toBe("2026-02-27T10:52:10");
    expect(metadata.timeSource).toBe("creation_time");
  });

  // Apple's own tag carries a real offset, and that offset names the zone the
  // wall clock is already in — so the local reading is kept and the offset
  // discarded, never added.
  it("prefers the QuickTime creation date and keeps its local reading", () => {
    const metadata = buildVideoPosterMetadata({
      streams: [videoStream()],
      format: {
        tags: {
          creation_time: "2025-11-25T09:12:33.000000Z",
          "com.apple.quicktime.creationdate": "2025-11-25T18:12:33+0900",
        },
      },
    });

    expect(metadata.capturedAtLocal).toBe("2025-11-25T18:12:33");
    expect(metadata.timeSource).toBe("quicktime-creationdate");
  });

  it("reads coordinates from either the format or the stream location tag", () => {
    const fromFormat = buildVideoPosterMetadata({
      streams: [videoStream()],
      format: { tags: { location: "+35.6895+139.6917/" } },
    });
    expect(fromFormat.latDeg).toBeCloseTo(35.6895, 4);
    expect(fromFormat.lngDeg).toBeCloseTo(139.6917, 4);

    const fromStream = buildVideoPosterMetadata({
      streams: [videoStream({ "com.apple.quicktime.location.ISO6709": "-33.8688+151.2093/" })],
      format: {},
    });
    expect(fromStream.latDeg).toBeCloseTo(-33.8688, 4);
    expect(fromStream.lngDeg).toBeCloseTo(151.2093, 4);
  });

  it("reports dimensions and duration, omitting what ffprobe did not give", () => {
    const metadata = buildVideoPosterMetadata({
      streams: [videoStream()],
      format: { duration: "13.013000" },
    });

    expect(metadata.width).toBe(3840);
    expect(metadata.height).toBe(2160);
    expect(metadata.durationSeconds).toBeCloseTo(13.013, 3);
    expect(metadata.capturedAtLocal).toBeUndefined();
    expect(metadata.latDeg).toBeUndefined();
    expect("latDeg" in metadata).toBe(false);
  });

  // A rotated phone clip reports its stored dimensions plus a display matrix;
  // the extracted frame is upright, so the metadata has to agree with it.
  it("swaps dimensions for a quarter-turn display matrix", () => {
    const metadata = buildVideoPosterMetadata({
      streams: [
        {
          ...videoStream(),
          side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
        },
      ],
      format: {},
    });

    expect(metadata.width).toBe(2160);
    expect(metadata.height).toBe(3840);
  });
});

describe("posterSeekSeconds", () => {
  // The first frame of a clip is very often black (fade-in, autofocus, a
  // shutter still closing), which is the worst possible poster.
  it("samples across the clip rather than opening on the first frame", () => {
    expect(posterSeekSeconds(20)).toEqual([2, 6, 10, 14]);
  });

  it("keeps the samples inside a very short clip", () => {
    const seeks = posterSeekSeconds(0.8);
    expect(seeks.length).toBeGreaterThan(0);
    seeks.forEach((seek) => expect(seek).toBeLessThan(0.8));
  });

  it("falls back to the start when the duration is unknown", () => {
    expect(posterSeekSeconds(undefined)).toEqual([0]);
    expect(posterSeekSeconds(0)).toEqual([0]);
  });
});

describe("scorePosterFrame", () => {
  // A frame with spread-out tones carries something to look at; a flat one is
  // a fade, a lens cap or a blown-out sky.
  it("prefers the frame with the most tonal spread", () => {
    expect(scorePosterFrame({ mean: 120, stdev: 60 })).toBeGreaterThan(
      scorePosterFrame({ mean: 120, stdev: 20 }),
    );
  });

  it("discounts frames that are nearly black or nearly white", () => {
    const midtone = scorePosterFrame({ mean: 120, stdev: 30 });
    expect(scorePosterFrame({ mean: 3, stdev: 30 })).toBeLessThan(midtone);
    expect(scorePosterFrame({ mean: 252, stdev: 30 })).toBeLessThan(midtone);
  });

  // A dark clip is still a clip: the least-bad frame has to win rather than
  // every candidate scoring zero and the choice falling back to the first.
  it("still separates candidates within a uniformly dark clip", () => {
    expect(scorePosterFrame({ mean: 6, stdev: 12 })).toBeGreaterThan(
      scorePosterFrame({ mean: 2, stdev: 3 }),
    );
  });
});

describe("sceneSeconds", () => {
  // One frame a minute is what makes a moment inside a long clip findable at
  // all: the clip's own poster only ever describes one instant of it.
  it("takes a frame each minute", () => {
    expect(sceneSeconds(200)).toEqual([60, 120, 180]);
  });

  it("has nothing to add for a clip shorter than the interval", () => {
    expect(sceneSeconds(45)).toEqual([]);
    expect(sceneSeconds(undefined)).toEqual([]);
  });

  // A frame taken in the last seconds of a clip is usually a fade or a hand
  // reaching for the camera, and it says nothing the previous minute did not.
  it("skips a frame that would land on the very end", () => {
    expect(sceneSeconds(62)).toEqual([]);
    expect(sceneSeconds(125)).toEqual([60]);
  });

  // Per-minute is linear, and an hour-long clip would otherwise mean an hour's
  // worth of embeddings; past the cap the interval stretches instead.
  it("stretches the interval rather than growing without bound", () => {
    const scenes = sceneSeconds(7200, { interval: 60, max: 60 });
    expect(scenes).toHaveLength(60);
    // Spread evenly across the whole clip rather than crowding its opening and
    // stopping an hour in.
    expect(scenes[0]).toBeGreaterThan(60);
    expect(scenes.at(-1)).toBeLessThan(7200);
    expect(scenes.at(-1)).toBeGreaterThan(7000);
    // Offsets are rounded to the millisecond, so successive gaps agree to well
    // under a frame rather than exactly.
    expect(scenes[2]! - scenes[1]!).toBeCloseTo(scenes[1]! - scenes[0]!, 2);
  });
});

describe("posterPathsFor", () => {
  it("puts display variants beside the album's photos and the source frame with the video cache", () => {
    const paths = posterPathsFor("/repo/albums/trip/clip.mov", "/repo/src/public/data/albums");

    expect(paths.albumName).toBe("trip");
    expect(paths.filename).toBe("clip.mov");
    expect(paths.posterSource).toBe(
      `/repo/src/public/data/albums/trip/.resized_videos/clip.mov${POSTER_SOURCE_SUFFIX}`,
    );
    expect(paths.sidecar).toBe(
      `/repo/src/public/data/albums/trip/.resized_videos/clip.mov${POSTER_SIDECAR_SUFFIX}`,
    );
    // Display variants share the photo cache directory and naming, so every
    // existing "@<size>.avif" URL builder addresses a video's poster without
    // knowing videos exist.
    expect(paths.variantDirectory).toBe("/repo/src/public/data/albums/trip/.resized_images");
    expect(paths.variantFor(800)).toBe(
      "/repo/src/public/data/albums/trip/.resized_images/clip.mov@800.avif",
    );
  });
});

describe("scenePosterPathsFor", () => {
  // Scene files are named for the clip plus the moment they came from, so that
  // one "@<size>.avif" URL builder still addresses them and the cache sweep can
  // trace each back to the video it belongs to.
  it("names a scene's cache entries after the clip and the moment", () => {
    const paths = scenePosterPathsFor(
      "/repo/albums/trip/clip.mov",
      120,
      "/repo/src/public/data/albums",
    );

    expect(paths.posterSource).toBe(
      "/repo/src/public/data/albums/trip/.resized_videos/clip.mov@t120@poster.jpg",
    );
    expect(paths.variantFor(800)).toBe(
      "/repo/src/public/data/albums/trip/.resized_images/clip.mov@t120@800.avif",
    );
  });
});

describe("readVideoPosterSidecar", () => {
  it("returns null when the sidecar is missing or corrupt", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-poster-sidecar-"));
    expect(readVideoPosterSidecar(path.join(root, "absent.json"))).toBeNull();

    const corrupt = path.join(root, "corrupt.json");
    fs.writeFileSync(corrupt, "{not json");
    expect(readVideoPosterSidecar(corrupt)).toBeNull();
  });

  it("reads a written sidecar back", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-poster-sidecar-"));
    const sidecar = path.join(root, "clip.mov@poster.json");
    fs.writeFileSync(
      sidecar,
      JSON.stringify({ mediaKind: "video", capturedAtLocal: "2026-02-27T10:52:10" }),
    );

    expect(readVideoPosterSidecar(sidecar)).toEqual({
      mediaKind: "video",
      capturedAtLocal: "2026-02-27T10:52:10",
    });
  });
});

const makeSyntheticVideo = (target: string, seconds: number) => {
  const ffmpeg = require("ffmpeg-static") as string;
  require("node:child_process").execFileSync(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=320x180:rate=10:duration=${seconds}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "10",
    target,
  ]);
};

describe("ensureVideoPoster", () => {
  const fixture = path.resolve(__dirname, "..", "..", "albums", "test-simple", "DSCF0159.MOV");

  it("extracts a decodable frame, encodes display variants, and reuses them", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-poster-"));
    const albumDir = path.join(root, "albums", "trip");
    fs.mkdirSync(albumDir, { recursive: true });
    const video = path.join(albumDir, "clip.mov");
    fs.copyFileSync(fixture, video);

    const options = {
      publicAlbumsDir: path.join(root, "public", "data", "albums"),
      sizes: [800],
      avif: { quality: 60, effort: 0 },
    };

    const first = await ensureVideoPoster(video, options);

    expect(first.extracted).toBe(true);
    expect(first.variantsEncoded).toBe(1);
    expect(fs.existsSync(first.paths.posterSource)).toBe(true);
    expect(fs.existsSync(first.paths.variantFor(800))).toBe(true);
    // The fixture is a 4K X-T5 clip stamped with camera-local wall time.
    expect(first.sidecar.capturedAtLocal).toBe("2026-02-27T10:52:10");
    expect(first.sidecar.width).toBe(3840);
    expect(first.sidecar.height).toBe(2160);

    const second = await ensureVideoPoster(video, options);
    expect(second.extracted).toBe(false);
    expect(second.variantsEncoded).toBe(0);
  }, 60_000);

  // The fixture is 13 seconds, so scene extraction needs a clip with minutes in
  // it. A synthetic one keeps the committed fixtures small while still driving
  // real ffmpeg seeks and real encodes.
  it("extracts a frame per interval and records the offsets in the sidecar", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-poster-scenes-"));
    const albumDir = path.join(root, "albums", "trip");
    fs.mkdirSync(albumDir, { recursive: true });
    const video = path.join(albumDir, "long.mp4");
    makeSyntheticVideo(video, 24);

    const options = {
      publicAlbumsDir: path.join(root, "public", "data", "albums"),
      sizes: [800],
      avif: { quality: 60, effort: 0 },
      candidateFractions: [0.5],
      // Stand in for a minute, so the test stays seconds long.
      sceneInterval: 6,
    };

    const first = await ensureVideoPoster(video, options);

    expect(first.scenes).toEqual([6, 12, 18]);
    expect(first.sidecar.scenes).toEqual([6, 12, 18]);
    first.scenes.forEach((seconds) => {
      const scene = scenePosterPathsFor(video, seconds, options.publicAlbumsDir);
      expect(fs.existsSync(scene.posterSource)).toBe(true);
      expect(fs.existsSync(scene.variantFor(800))).toBe(true);
    });

    // A second pass reuses every frame and every variant.
    const second = await ensureVideoPoster(video, options);
    expect(second.scenes).toEqual([6, 12, 18]);
    expect(second.variantsEncoded).toBe(0);
  }, 120_000);

  it("takes no scenes from a clip shorter than the interval", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-poster-scenes-"));
    const albumDir = path.join(root, "albums", "trip");
    fs.mkdirSync(albumDir, { recursive: true });
    const video = path.join(albumDir, "short.mp4");
    makeSyntheticVideo(video, 5);

    const result = await ensureVideoPoster(video, {
      publicAlbumsDir: path.join(root, "public", "data", "albums"),
      sizes: [800],
      avif: { quality: 60, effort: 0 },
      candidateFractions: [0.5],
      sceneInterval: 60,
    });

    expect(result.scenes).toEqual([]);
    expect(result.sidecar.scenes).toBeUndefined();
  }, 120_000);

  it("re-extracts when the source video changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-poster-"));
    const albumDir = path.join(root, "albums", "trip");
    fs.mkdirSync(albumDir, { recursive: true });
    const video = path.join(albumDir, "clip.mov");
    fs.copyFileSync(fixture, video);

    const options = {
      publicAlbumsDir: path.join(root, "public", "data", "albums"),
      sizes: [800],
      avif: { quality: 60, effort: 0 },
      candidateFractions: [0.5],
    };

    await ensureVideoPoster(video, options);
    // A re-export of the same clip: same bytes on disk are not assumed, the
    // recorded size/mtime pair is what decides.
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(video, future, future);

    const rerun = await ensureVideoPoster(video, options);
    expect(rerun.extracted).toBe(true);
  }, 60_000);
});
