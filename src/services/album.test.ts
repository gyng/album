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

import { getAlbum, getBlockDate, getImageTimestampRange } from "./album";
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
    exif: { DateTimeOriginal: dateStr },
    tags: [],
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
  data: { type: "youtube", href: "https://youtube.com/watch?v=test", date },
});

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
});

describe("getImageTimestampRange", () => {
  it("returns [null, null] for an album with no blocks", () => {
    expect(getImageTimestampRange(makeContent([]))).toEqual([null, null]);
  });

  it("returns [null, null] when there are no photo blocks", () => {
    expect(
      getImageTimestampRange(makeContent([makeText(), makeVideo("2024-01-01")])),
    ).toEqual([null, null]);
  });

  it("returns the same timestamp for both ends when there is one photo", () => {
    const date = "2024-03-10T08:00:00Z";
    const ts = new Date(date).getTime();
    expect(getImageTimestampRange(makeContent([makePhoto(date)]))).toEqual([
      ts,
      ts,
    ]);
  });

  it("returns [earliest, latest] across multiple photos", () => {
    const early = "2022-01-01T00:00:00Z";
    const mid = "2023-06-15T00:00:00Z";
    const late = "2024-12-31T00:00:00Z";
    const [earliest, latest] = getImageTimestampRange(
      makeContent([makePhoto(mid), makePhoto(late), makePhoto(early)]),
    );
    expect(earliest).toBe(new Date(early).getTime());
    expect(latest).toBe(new Date(late).getTime());
  });

  it("ignores non-photo blocks when computing the range", () => {
    const date = "2024-05-20T00:00:00Z";
    const ts = new Date(date).getTime();
    const [earliest, latest] = getImageTimestampRange(
      makeContent([makeText(), makePhoto(date), makeVideo("2020-01-01")]),
    );
    expect(earliest).toBe(ts);
    expect(latest).toBe(ts);
  });

  it("returns [null, null] when all photo dates are missing", () => {
    expect(
      getImageTimestampRange(makeContent([makePhoto(), makePhoto()])),
    ).toEqual([null, null]);
  });
});

describe("getAlbum", () => {
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
});
