/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

jest.mock("uuid", () => ({ v4: jest.fn(() => "test-uuid") }));
jest.mock("./deserialize", () => ({
  deserializeContentBlock: jest.fn(async (serialized, dirname) => ({
    ...serialized,
    blocks: serialized.blocks,
    _build: {
      slug: serialized.name,
      srcdir: dirname,
    },
  })),
}));

import { deserializeContentBlock } from "./deserialize";
import {
  ALBUMS_DIR,
  getAlbum,
  getAlbumFromName,
  getAlbumNames,
  getAlbums,
  getAlbumWithManifest,
  getAlbumWithoutManifest,
  getBlockDate,
  getImageTimestampRange,
  MANIFEST_NAME,
  MANIFEST_V2_NAME,
} from "./album";
import { Block, Content, PhotoBlock, TextBlock, VideoBlock } from "./types";

const makeContent = (blocks: Block[]): Content => ({
  name: "test",
  title: "Test Album",
  blocks,
  formatting: {},
  _build: { slug: "test", srcdir: "/test" },
});

const makePhoto = (dateStr?: string): PhotoBlock => ({
  kind: "photo",
  id: "p1",
  data: { src: "photo.jpg" },
  _build: {
    height: 100,
    width: 100,
    exif: dateStr !== undefined ? { DateTimeOriginal: dateStr } : {},
    tags: {},
    srcset: [],
  },
});

const makeText = (): TextBlock => ({
  kind: "text",
  id: "t1",
  data: { title: "Title" },
});

const makeVideo = (date?: string): VideoBlock => ({
  kind: "video",
  id: "v1",
  data: {
    type: "youtube",
    href: "https://youtube.com/watch?v=test",
    ...(date !== undefined ? { date } : {}),
  },
});

const mockDeserialize = jest.mocked(deserializeContentBlock);

describe("getBlockDate", () => {
  it("returns 1 for text blocks", () => {
    expect(getBlockDate(makeText())).toBe(1);
  });

  it("returns the timestamp for a photo block with a valid ISO date", () => {
    const date = "2024-06-15T12:00:00Z";
    const result = getBlockDate(makePhoto(date));
    expect(result).toBe(new Date(date).getTime());
  });

  it("returns a finite fallback timestamp for a photo block with no date", () => {
    // undefined DateTimeOriginal falls back via ?? 0 → Date.parse(0), a finite sort sentinel
    expect(Number.isFinite(getBlockDate(makePhoto(undefined)))).toBe(true);
  });

  it("returns the timestamp for a video block with a date", () => {
    const date = "2023-09-01T00:00:00Z";
    const result = getBlockDate(makeVideo(date));
    expect(result).toBe(new Date(date).getTime());
  });

  it("returns 0 for a video block with no date", () => {
    expect(getBlockDate(makeVideo(undefined))).toBe(0);
  });

  it("returns 0 (not NaN) for a video block with an unparseable date", () => {
    // Without the isNaN guard, a malformed manifest date scrambles block order.
    expect(getBlockDate(makeVideo("not-a-date"))).toBe(0);
  });

  it("returns zero for unsupported block kinds", () => {
    expect(getBlockDate({ kind: "audio" } as never)).toBe(0);
  });
});

describe("getImageTimestampRange", () => {
  it("returns [null, null] for an album with no blocks", () => {
    expect(getImageTimestampRange(makeContent([]))).toEqual([null, null]);
  });

  it("returns [null, null] when there are no photo blocks", () => {
    expect(getImageTimestampRange(makeContent([makeText(), makeVideo("2024-01-01")]))).toEqual([
      null,
      null,
    ]);
  });

  it("returns the same timestamp for both ends when there is one photo", () => {
    const date = "2024-03-10T08:00:00Z";
    const timestamp = "2024-03-10T08:00:00";
    expect(getImageTimestampRange(makeContent([makePhoto(date)]))).toEqual([timestamp, timestamp]);
  });

  it("returns [earliest, latest] across multiple photos", () => {
    const early = "2022-01-01T00:00:00Z";
    const mid = "2023-06-15T00:00:00Z";
    const late = "2024-12-31T00:00:00Z";
    const [earliest, latest] = getImageTimestampRange(
      makeContent([makePhoto(mid), makePhoto(late), makePhoto(early)]),
    );
    expect(earliest).toBe("2022-01-01T00:00:00");
    expect(latest).toBe("2024-12-31T00:00:00");
  });

  it("ignores non-photo blocks when computing the range", () => {
    const date = "2024-05-20T00:00:00Z";
    const timestamp = "2024-05-20T00:00:00";
    const [earliest, latest] = getImageTimestampRange(
      makeContent([makeText(), makePhoto(date), makeVideo("2020-01-01")]),
    );
    expect(earliest).toBe(timestamp);
    expect(latest).toBe(timestamp);
  });

  it("returns [null, null] when all photo dates are missing", () => {
    expect(getImageTimestampRange(makeContent([makePhoto(), makePhoto()]))).toEqual([null, null]);
  });

  it("keeps pre-1970 scanned-film dates instead of treating them as missing", () => {
    const film = "1965-06-15T00:00:00Z";
    expect(getImageTimestampRange(makeContent([makePhoto(film)]))).toEqual([
      "1965-06-15T00:00:00",
      "1965-06-15T00:00:00",
    ]);
  });
});

describe("getAlbum", () => {
  it("uses the repository album and manifest conventions", () => {
    expect({ ALBUMS_DIR, MANIFEST_NAME, MANIFEST_V2_NAME }).toEqual({
      ALBUMS_DIR: "../albums",
      MANIFEST_NAME: "manifest.json",
      MANIFEST_V2_NAME: "album.json",
    });
  });

  it("sorts external blocks by manifest sort order", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-sort-test-"));
    const albumDir = path.join(root, "trip");
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(
      path.join(albumDir, "album.json"),
      JSON.stringify({
        sort: "newest-first",
        externals: [
          {
            type: "youtube",
            href: "https://youtube.com/watch?v=older",
            date: "2023-01-01T00:00:00Z",
          },
          {
            type: "youtube",
            href: "https://youtube.com/watch?v=newer",
            date: "2024-01-01T00:00:00Z",
          },
        ],
      }),
    );

    try {
      const album = await getAlbum(albumDir);
      const videoHrefs = album.blocks
        .filter((block): block is VideoBlock => block.kind === "video")
        .map((block) => block.data.href);

      expect(album.blocks[0]?.kind).toBe("text");
      expect(videoHrefs).toEqual([
        "https://youtube.com/watch?v=newer",
        "https://youtube.com/watch?v=older",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // A random id per build means nothing can address an external: not a search
  // result's "#<name>" deep link, not a shared URL, not the page's own permalink.
  it("gives external blocks ids that survive a rebuild", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-external-id-"));
    const albumDir = path.join(root, "trip");
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(
      path.join(albumDir, "album.json"),
      JSON.stringify({
        externals: [
          { type: "youtube", href: "https://www.youtube.com/embed/ycyUWULJxdU" },
          { type: "local", href: "clip.mov" },
        ],
      }),
    );

    try {
      const first = await getAlbum(albumDir);
      const second = await getAlbum(albumDir);
      const ids = (album: Awaited<ReturnType<typeof getAlbum>>) =>
        album.blocks.filter((block) => block.kind === "video").map((block) => block.id);

      expect(ids(first)).toEqual(ids(second));
      // The ids match the names the search index stores for the same media, so
      // "/album/trip#<id>" resolves for both kinds of video.
      expect(ids(first)).toEqual(["ycyUWULJxdU.youtube", "clip.mov"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("defaults external blocks to oldest first when no sort order is provided", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-sort-test-"));
    const albumDir = path.join(root, "trip");
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(
      path.join(albumDir, "album.json"),
      JSON.stringify({
        externals: [
          {
            type: "youtube",
            href: "https://youtube.com/watch?v=newer",
            date: "2024-01-01T00:00:00Z",
          },
          {
            type: "youtube",
            href: "https://youtube.com/watch?v=older",
            date: "2023-01-01T00:00:00Z",
          },
        ],
      }),
    );

    try {
      const album = await getAlbum(albumDir);
      const videoHrefs = album.blocks
        .filter((block): block is VideoBlock => block.kind === "video")
        .map((block) => block.data.href);

      expect(videoHrefs).toEqual([
        "https://youtube.com/watch?v=older",
        "https://youtube.com/watch?v=newer",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not set a 1970-style kicker when no dated photos exist", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-kicker-test-"));
    const albumDir = path.join(root, "trip");
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, "photo.jpg"), "x");

    try {
      const album = await getAlbum(albumDir);
      const titleBlock = album.blocks[0];

      expect(titleBlock?.kind).toBe("text");
      if (titleBlock?.kind === "text") {
        expect(titleBlock.data.kicker).toBeUndefined();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists only album directories and loads each one", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-list-test-"));
    fs.mkdirSync(path.join(root, "one"));
    fs.mkdirSync(path.join(root, "two"));
    fs.writeFileSync(path.join(root, "README.txt"), "not an album");

    try {
      await expect(getAlbumNames(root)).resolves.toEqual(["one", "two"]);
      await expect(getAlbums(root)).resolves.toHaveLength(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("hides test fixture albums unless explicitly included", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-list-test-"));
    const previousIncludeTestAlbums = process.env.ALBUM_INCLUDE_TEST_ALBUMS;
    fs.mkdirSync(path.join(root, "real"));
    fs.mkdirSync(path.join(root, "test-simple"));
    fs.mkdirSync(path.join(root, "test-manifest-v2"));
    delete process.env.ALBUM_INCLUDE_TEST_ALBUMS;

    try {
      await expect(getAlbumNames(root)).resolves.toEqual(["real"]);

      process.env.ALBUM_INCLUDE_TEST_ALBUMS = "1";
      await expect(getAlbumNames(root)).resolves.toEqual([
        "real",
        "test-manifest-v2",
        "test-simple",
      ]);
    } finally {
      if (previousIncludeTestAlbums === undefined) {
        delete process.env.ALBUM_INCLUDE_TEST_ALBUMS;
      } else {
        process.env.ALBUM_INCLUDE_TEST_ALBUMS = previousIncludeTestAlbums;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports the default albums directory adapters without reading media", async () => {
    const readdir = jest.spyOn(fs, "readdirSync").mockReturnValue([]);

    try {
      await expect(getAlbumNames()).resolves.toEqual([]);
      await expect(getAlbums()).resolves.toEqual([]);
      await expect(getAlbumFromName("virtual-default")).resolves.toMatchObject({
        name: "virtual-default",
      });
    } finally {
      readdir.mockRestore();
    }
  });

  it("builds a manifest-free mixed-media album and removes Zone.Identifier files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-media-test-"));
    const albumDir = path.join(root, "trip.newest-first");
    fs.mkdirSync(path.join(albumDir, "nested"), { recursive: true });
    fs.writeFileSync(path.join(albumDir, "cover.jpg"), "photo");
    fs.writeFileSync(path.join(albumDir, "clip.MOV"), "video");
    fs.writeFileSync(path.join(albumDir, "ignored.json"), "{}");
    const sidecar = path.join(albumDir, "cover.jpg:Zone.Identifier");
    fs.writeFileSync(sidecar, "zone");
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const result = await getAlbumWithoutManifest(albumDir);

      expect(result.formatting.sort).toBe("newest-first");
      expect(result.cover).toMatchObject({ data: { src: "cover.jpg" } });
      expect(result.blocks.map(({ kind }) => kind)).toEqual(["text", "photo", "video"]);
      expect(fs.existsSync(sidecar)).toBe(false);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Deleted Zone.Identifier"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("warns and continues if a Zone.Identifier sidecar cannot be removed", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-sidecar-test-"));
    fs.writeFileSync(path.join(root, "photo.jpg:Zone.Identifier"), "zone");
    const failure = new Error("permission denied");
    jest.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw failure;
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const result = await getAlbumWithoutManifest(root);

      expect(result.blocks).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to delete Zone.Identifier sidecar"),
        failure,
      );
    } finally {
      jest.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads legacy manifests directly", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-legacy-test-"));
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify({ name: "legacy", title: "Legacy", formatting: {}, blocks: [] }),
    );

    try {
      await expect(getAlbumWithManifest(root)).resolves.toMatchObject({ name: "legacy" });
      await expect(getAlbum(root)).resolves.toMatchObject({ name: "legacy" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies v2 cover and external-video configuration exactly", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-v2-test-"));
    fs.writeFileSync(path.join(root, "1.jpg"), "photo");
    fs.writeFileSync(path.join(root, "11.jpg"), "photo");
    fs.writeFileSync(
      path.join(root, "album.json"),
      JSON.stringify({
        cover: "1.jpg",
        externals: [
          { type: "youtube", href: "https://youtu.be/undated" },
          { type: "youtube", href: "https://youtu.be/dated", date: "2024-01-01" },
          { type: "local", href: "clip.mp4" },
          { type: "local", href: "dated.mp4", date: "2024-01-02" },
          { type: "local", href: "clip.mp4:Zone.Identifier" },
        ],
      }),
    );

    try {
      const result = await getAlbum(root);
      const photos = result.blocks.filter((block) => block.kind === "photo");
      const videos = result.blocks.filter((block) => block.kind === "video");

      expect(result.cover).toEqual({ src: "1.jpg" });
      expect(photos.find((block) => block.id === "1.jpg")?.formatting?.cover).toBe(true);
      expect(photos.find((block) => block.id === "11.jpg")?.formatting?.cover).not.toBe(true);
      expect(videos).toHaveLength(4);
      expect(videos.map((block) => block.data)).toEqual(
        expect.arrayContaining([
          { type: "youtube", href: "https://youtu.be/undated" },
          { type: "youtube", href: "https://youtu.be/dated", date: "2024-01-01" },
          { type: "local", href: "clip.mp4" },
          { type: "local", href: "dated.mp4", date: "2024-01-02" },
        ]),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("records a configured cover even when no matching photo exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-cover-test-"));
    fs.writeFileSync(path.join(root, "photo.jpg"), "photo");
    fs.writeFileSync(path.join(root, "album.json"), JSON.stringify({ cover: "missing.jpg" }));

    try {
      await expect(getAlbum(root)).resolves.toMatchObject({ cover: { src: "missing.jpg" } });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    [["2023-01-01T00:00:00", "2024-01-01T00:00:00"], "2023–2024"],
    [["2024-01-01T00:00:00", "2024-12-31T00:00:00"], "2024"],
  ])("derives a chronological title kicker from photo years", async (dates, expected) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-kicker-years-test-"));
    mockDeserialize.mockResolvedValueOnce(
      makeContent([makeText(), makePhoto(dates[1]), makePhoto(dates[0])]),
    );

    try {
      const result = await getAlbum(root);
      const title = result.blocks[0];
      expect(title?.kind).toBe("text");
      if (title?.kind === "text") expect(title.data.kicker).toBe(expected);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves the kicker alone when deserialisation produces no title block", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-no-title-test-"));
    mockDeserialize.mockResolvedValueOnce(makeContent([makePhoto("2024-01-01T00:00:00")]));

    try {
      await expect(getAlbum(root)).resolves.toMatchObject({ blocks: [expect.any(Object)] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reuses successful album promises and evicts rejected ones", async () => {
    const cachedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-cache-test-"));
    const rejectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-reject-test-"));

    try {
      const first = getAlbum(cachedRoot);
      const second = getAlbum(cachedRoot);
      await expect(second).resolves.toBe(await first);

      mockDeserialize.mockRejectedValueOnce(new Error("deserialisation failed"));
      await expect(getAlbum(rejectedRoot)).rejects.toThrow("deserialisation failed");
      await Promise.resolve();
      await expect(getAlbum(rejectedRoot)).resolves.toMatchObject({
        name: path.basename(rejectedRoot),
      });
    } finally {
      fs.rmSync(cachedRoot, { recursive: true, force: true });
      fs.rmSync(rejectedRoot, { recursive: true, force: true });
    }
  });
});
