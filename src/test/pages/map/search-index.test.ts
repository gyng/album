import type { Content, PhotoBlock, TextBlock } from "../../../services/types";

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

  it("exposes the entries as a framework-neutral JSON response", async () => {
    mockGetAlbums.mockResolvedValue([]);

    const response = await GET();

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    await expect(response.json()).resolves.toEqual({ entries: [] });
  });
});
