import type { Content, PhotoBlock, TextBlock, VideoBlock } from "../../../services/types";

jest.mock("../../../services/album", () => ({ getAlbums: jest.fn() }));

import { GET } from "../../../app/data/map-search-index.json/route";
import { loadMapSearchIndexEntries } from "../../../services/mapSearchIndex";

const { getAlbums: mockGetAlbums } = jest.requireMock("../../../services/album") as {
  getAlbums: jest.Mock;
};

const mappedPhoto = (description?: string): PhotoBlock => ({
  kind: "photo",
  id: description ? "market.jpg" : "empty.jpg",
  data: {
    src: description ? "night market.jpg" : "empty.jpg",
    ...(description ? { description } : {}),
  },
  _build: {
    width: 100,
    height: 100,
    exif: {
      GPSLongitude: [103, 1, 1],
      GPSLatitude: [1, 1, 1],
      GPSLongitudeRef: "E",
      GPSLatitudeRef: "N",
    },
    tags: {},
    srcset: [],
  },
});

describe("map search data endpoint", () => {
  beforeEach(() => {
    mockGetAlbums.mockReset();
  });

  it("builds compact entries only for mapped photos with searchable text", async () => {
    const text: TextBlock = { kind: "text", id: "intro", data: { title: "Intro" } };
    const album: Content = {
      name: "singapore",
      title: "Singapore",
      blocks: [text, mappedPhoto("Night market"), mappedPhoto()],
      formatting: {},
      _build: { slug: "singapore", srcdir: "../albums/singapore" },
    };
    mockGetAlbums.mockResolvedValue([album]);

    await expect(loadMapSearchIndexEntries()).resolves.toEqual([
      ["/album/singapore#night%20market.jpg", "Night market"],
    ]);
  });

  // A clip's indexed row and its camera are as searchable as a photograph's;
  // the index used to hold only its filename.
  it("finds a clip by what its indexed row and its camera say", async () => {
    const clip: VideoBlock = {
      kind: "video",
      id: "DSCF7497.MOV",
      data: { type: "local", href: "/DSCF7497.MOV" },
      _build: {
        src: "/DSCF7497.MOV@1920.mp4",
        mimeType: "video/mp4",
        poster: { srcset: [{ src: "/DSCF7497.MOV@800.avif", width: 800, height: 450 }] },
        capturedAtLocal: "2025-12-01T20:15:51",
        latDeg: 35.66,
        lngDeg: 139.73,
        camera: { Make: "FUJIFILM", Model: "X-T5" },
        tags: { alt_text: "City lights from an observation deck.", tags: ["night"] },
      },
    };
    mockGetAlbums.mockResolvedValue([
      {
        name: "tokyo",
        title: "Tokyo",
        blocks: [clip],
        formatting: {},
        _build: { slug: "tokyo", srcdir: "../albums/tokyo" },
      } satisfies Content,
    ]);

    const [entry] = await loadMapSearchIndexEntries();
    expect(entry?.[0]).toBe("/album/tokyo#DSCF7497.MOV");
    for (const text of ["DSCF7497.MOV", "observation deck", "night", "X-T5"]) {
      expect(entry?.[1]).toContain(text);
    }
  });

  it("exposes the entries as a framework-neutral JSON response", async () => {
    mockGetAlbums.mockResolvedValue([]);

    const response = await GET();

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    await expect(response.json()).resolves.toEqual({ entries: [] });
  });
});
