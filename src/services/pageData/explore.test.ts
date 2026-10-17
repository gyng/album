import type { Content, VideoBlock } from "../types";
import { loadExploreClips } from "./explore";

// Album loading and the embeddings statistics are the build's I/O, not what
// is under test here.
jest.mock("../album", () => ({ getAlbums: jest.fn() }));
jest.mock("../../util/computeEmbeddingStats", () => ({
  computeVisualSamenessStats: jest.fn(),
}));

const clip = (id: string, capturedAtLocal: string): VideoBlock => ({
  kind: "video",
  id,
  data: { type: "local", href: `/${id}` },
  _build: {
    src: `/data/albums/trip/.resized_videos/${id}@1920.mp4`,
    mimeType: "video/mp4",
    poster: { srcset: [{ src: `/${id}@800.avif`, width: 800, height: 450 }] },
    capturedAtLocal,
  },
});

const album = (blocks: VideoBlock[]): Content => ({
  name: "trip",
  title: "trip",
  blocks,
  formatting: {},
  _build: { slug: "trip", srcdir: "../albums/trip" },
});

describe("loadExploreClips", () => {
  // A clip's wall clock is the sidecar's ISO form or a manifest date in EXIF's
  // colon form, and both are valid. Compared as raw strings, ":" sorts after
  // "-", so every colon-form clip read as newer than the whole year.
  it("orders clips by their moment whatever form the moment was written in", () => {
    const clips = loadExploreClips([
      album([
        clip("may.mov", "2024:05:01 10:00:00"),
        clip("december.mov", "2024-12-24T18:00:00"),
        clip("july.mov", "2024-07-04T09:00:00"),
      ]),
    ]);

    expect(clips.map((row) => row.id)).toEqual(["december.mov", "july.mov", "may.mov"]);
  });
});
