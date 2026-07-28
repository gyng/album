/**
 * @jest-environment node
 */

import fs from "node:fs";

jest.mock("./photo", () => ({
  getNextJsSafeExif: jest.fn(),
  getPhotoSize: jest.fn(),
  optimiseImages: jest.fn(),
  stripPublicFromPath: jest.fn((value: string) => `/built/${value.split("/").at(-1)}`),
}));
jest.mock("./video", () => ({
  getOriginalVideoTechnicalData: jest.fn(),
  optimiseVideo: jest.fn(),
  readVideoPoster: jest.fn(() => null),
}));
jest.mock("./buildTiming", () => ({
  incrementBuildCounter: jest.fn(),
  measureBuild: (_name: string, work: () => unknown) => work(),
}));
jest.mock("../util/colorDistance", () => ({
  parseColorPalette: jest.fn(() => [[1, 2, 3]]),
}));
jest.mock("sqlite3", () => {
  const Database = jest.fn();
  return {
    __Database: Database,
    verbose: () => ({ Database }),
  };
});

import { getNextJsSafeExif, getPhotoSize, optimiseImages } from "./photo";
import { getOriginalVideoTechnicalData, optimiseVideo, readVideoPoster } from "./video";
import {
  deserializeBlock,
  deserializeContentBlock,
  deserializeInternals,
  deserializePhotoBlock,
  deserializeTextBlock,
  deserializeVideoBlock,
} from "./deserialize";
import type { SerializedContent, SerializedPhotoBlock, SerializedVideoBlock } from "./types";

const mockGetExif = jest.mocked(getNextJsSafeExif);
const mockGetPhotoSize = jest.mocked(getPhotoSize);
const mockOptimiseImages = jest.mocked(optimiseImages);
const mockGetVideoData = jest.mocked(getOriginalVideoTechnicalData);
const mockOptimiseVideo = jest.mocked(optimiseVideo);
const { __Database: MockDatabase } = jest.requireMock("sqlite3") as {
  __Database: jest.Mock;
};

const photo = (src = "photo.jpg"): SerializedPhotoBlock => ({
  kind: "photo",
  id: src,
  data: { src },
});

const localVideo = (href = "clip.mp4"): SerializedVideoBlock => ({
  kind: "video",
  id: href,
  data: { type: "local", href },
});

describe("deserialisation adapter boundaries", () => {
  let db: { get: jest.Mock; close: jest.Mock };

  beforeEach(() => {
    db = {
      get: jest.fn((_sql, _params, callback) => callback(null, { colors: "palette" })),
      close: jest.fn((callback) => callback()),
    };
    MockDatabase.mockReset().mockImplementation(() => db);
    mockGetPhotoSize.mockReset().mockResolvedValue({ width: 1200, height: 800 });
    mockGetExif.mockReset().mockResolvedValue({ Model: "X-T5" });
    mockOptimiseImages
      .mockReset()
      .mockResolvedValue([{ src: "/photo.avif", width: 1200, height: 800 }]);
    mockOptimiseVideo.mockReset().mockResolvedValue({ src: "/clip.mp4", mimeType: "video/mp4" });
    mockGetVideoData.mockReset().mockResolvedValue({ codec: "h264" });
  });

  afterEach(async () => {
    await deserializeInternals.resetForTesting();
    jest.restoreAllMocks();
  });

  it("copies text and passes through hosted videos", async () => {
    const text = { kind: "text", id: "intro", data: { title: "Intro" } } as const;
    const youtube = {
      kind: "video",
      id: "youtube",
      data: { type: "youtube", href: "https://youtu.be/example" },
    } as const;

    await expect(deserializeTextBlock(text)).resolves.toEqual(text);
    await expect(deserializeVideoBlock(youtube, { dirname: "albums/trip" })).resolves.toEqual(
      youtube,
    );
    await expect(deserializeBlock(text)).resolves.toEqual(text);
  });

  // An external has no file in the album, but the poster prepass downloads its
  // thumbnail and writes a sidecar for it — the same shape a local clip gets.
  // Without that on the block, an external is invisible to the timeline.
  it("carries the poster and recorded time of a YouTube external", async () => {
    (readVideoPoster as jest.Mock).mockReturnValue({
      srcset: [{ src: "/ycyUWULJxdU.youtube@800.avif", width: 800, height: 450 }],
      capturedAtLocal: "2025-12-01T22:00:00",
    });

    const block = await deserializeVideoBlock(
      {
        kind: "video",
        id: "ycyUWULJxdU.youtube",
        data: {
          type: "youtube",
          href: "https://www.youtube.com/embed/ycyUWULJxdU",
          date: "2025-12-01T22:00:00+09:00",
        },
      },
      { dirname: "public/data/albums/kansai" },
    );

    expect(block._build?.poster?.srcset?.[0]?.src).toBe("/ycyUWULJxdU.youtube@800.avif");
    expect(block._build?.capturedAtLocal).toBe("2025-12-01T22:00:00");
    // The embed URL is untouched: it is what the page renders.
    expect(block.data.href).toBe("https://www.youtube.com/embed/ycyUWULJxdU");
    (readVideoPoster as jest.Mock).mockReturnValue(null);
  });

  it("builds local video metadata and omits an unavailable date", async () => {
    const result = await deserializeVideoBlock(localVideo(), { dirname: "albums/trip" });

    expect(result).toMatchObject({
      data: { type: "local", href: "/clip.mp4" },
      _build: {
        src: "/clip.mp4",
        originalSrc: "clip.mp4",
        mimeType: "video/mp4",
        originalTechnicalData: { codec: "h264" },
      },
    });
    expect(result.data).not.toHaveProperty("date");
  });

  it("requires a directory for local media and rejects unknown block kinds", async () => {
    await expect(deserializeBlock(photo())).rejects.toThrow("Need dirname for photoblock deser");
    await expect(deserializeBlock(localVideo())).rejects.toThrow(
      "Need dirname for videoblock deser",
    );
    await expect(deserializeBlock({ kind: "audio" } as never)).rejects.toThrow(
      "unsupported block kind",
    );
  });

  it("normalises missing search metadata to an empty tags object", async () => {
    jest.spyOn(fs, "existsSync").mockImplementation((value) => value !== "public/search.sqlite");

    const result = await deserializePhotoBlock(
      { ...photo("cover.jpg"), formatting: { cover: false, immersive: true } },
      { dirname: "albums/trip" },
    );

    expect(result).toMatchObject({
      data: { src: "/built/cover.jpg" },
      formatting: { cover: false, immersive: true },
      _build: { width: 1200, height: 800, tags: {} },
    });
  });

  it("uses the configured same-origin search database during builds", () => {
    const originalUrl = process.env.NEXT_PUBLIC_SEARCH_DATABASE_URL;
    try {
      process.env.NEXT_PUBLIC_SEARCH_DATABASE_URL = "/e2e-search.sqlite?v=fixture";

      expect(deserializeInternals.getConfiguredSearchDbPath()).toBe("public/e2e-search.sqlite");

      process.env.NEXT_PUBLIC_SEARCH_DATABASE_URL = "https://cdn.example.com/search.sqlite";
      expect(deserializeInternals.getConfiguredSearchDbPath()).toBe("public/search.sqlite");
    } finally {
      if (originalUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SEARCH_DATABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SEARCH_DATABASE_URL = originalUrl;
      }
    }
  });

  it("caches database rows, reuses the connection, and parses stored colours", async () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(true);

    const first = await deserializePhotoBlock(photo("first.jpg"), { dirname: "albums/trip" });
    const cached = await deserializePhotoBlock(photo("first.jpg"), { dirname: "albums/trip" });
    await deserializePhotoBlock(photo("second.jpg"), { dirname: "albums/trip" });

    expect(first._build.tags).toEqual({ colors: [[1, 2, 3]] });
    expect(cached._build.tags).toEqual(first._build.tags);
    expect(MockDatabase).toHaveBeenCalledTimes(1);
    expect(db.get).toHaveBeenCalledTimes(2);
  });

  it("keeps rows without colour metadata unchanged", async () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    db.get.mockImplementationOnce((_sql, _params, callback) =>
      callback(null, { geocode: "Tokyo" }),
    );

    const result = await deserializePhotoBlock(photo(), { dirname: "albums/trip" });

    expect(result._build.tags).toEqual({ geocode: "Tokyo" });
  });

  it("drops failed index lookups from the cache and continues with empty tags", async () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    const databaseFailure = new Error("database read failed");
    db.get.mockImplementation((_sql, _params, callback) => callback(databaseFailure));
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);

    const first = await deserializePhotoBlock(photo(), { dirname: "albums/trip" });
    await Promise.resolve();
    const second = await deserializePhotoBlock(photo(), { dirname: "albums/trip" });

    expect(first._build.tags).toEqual({});
    expect(second._build.tags).toEqual({});
    expect(db.get).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith(
      "Failed to get details from index, skipping",
      databaseFailure,
    );
  });

  it("skips missing local videos in content but propagates unrelated failures", async () => {
    const input: SerializedContent = {
      name: "trip",
      title: "Trip",
      formatting: {},
      blocks: [localVideo("missing.mp4")],
    };
    mockOptimiseVideo.mockRejectedValueOnce(new Error("Input file is missing: missing.mp4"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(deserializeContentBlock(input, "albums/trip")).resolves.toMatchObject({
      blocks: [],
      _build: { slug: "trip", srcdir: "albums/trip" },
    });
    expect(warn).toHaveBeenCalledWith("Skipping missing media file: albums/trip/missing.mp4");

    mockOptimiseVideo.mockRejectedValueOnce("non-error failure");
    await expect(deserializeContentBlock(input, "albums/trip")).rejects.toBe("non-error failure");
  });
});
