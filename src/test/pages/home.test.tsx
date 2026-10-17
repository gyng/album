/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { Content, PhotoBlock, TextBlock, VideoBlock } from "../../services/types";
import { coverBlockOf } from "../../util/videoBlockMedia";

const getTimestampRange = (album: Content): [string | null, string | null] => {
  const ranges: Record<string, [string | null, string | null]> = {
    featured: ["2022-01-01", "2022-02-01"],
    recent: ["2025-01-01", "2025-02-01"],
    older: [null, null],
    "test-fixture": ["2026-01-01", "2026-02-01"],
  };
  return ranges[album.name] ?? [null, null];
};

jest.mock("../../services/album", () => ({
  getAlbums: jest.fn(),
  getImageTimestampRange: jest.fn(),
}));

jest.mock("../../services/buildTiming", () => ({
  measureBuild: (_name: string, work: () => unknown) => work(),
}));

jest.mock("../../components/Albums", () => ({
  Albums: ({ albums }: { albums: Content[] }) => (
    <output data-testid="albums">{JSON.stringify(albums)}</output>
  ),
}));

jest.mock("../../components/GlobalNav", () => ({ GlobalNav: () => <nav /> }));
jest.mock("../../components/Seo", () => ({ Seo: () => null }));
jest.mock("../../components/ui", () => ({
  Footer: () => <footer />,
  Heading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));

import Home from "../../screens/HomeScreen";
import { loadHomePageData } from "../../services/pageData/home";

const { getAlbums: mockGetAlbums, getImageTimestampRange: mockGetImageTimestampRange } =
  jest.requireMock("../../services/album") as {
    getAlbums: jest.Mock;
    getImageTimestampRange: jest.Mock;
  };

const photo = (id: string, cover = false): PhotoBlock => ({
  kind: "photo",
  id,
  data: { src: id },
  ...(cover ? { formatting: { cover: true } } : {}),
  _build: { width: 100, height: 100, exif: {}, tags: {}, srcset: [] },
});

const text = (id: string): TextBlock => ({
  kind: "text",
  id,
  data: { title: id },
});

const video = (id: string): VideoBlock => ({
  kind: "video",
  id,
  data: { type: "local", href: id },
  _build: {
    src: `${id}@1920.mp4`,
    mimeType: "video/mp4",
    poster: { srcset: [{ src: `${id}.avif`, width: 100, height: 100 }] },
    capturedAtLocal: "2024-05-01T09:00:00",
  },
});

const album = (name: string, blocks: Content["blocks"], order?: number): Content => ({
  name,
  title: name,
  blocks,
  ...(order === undefined ? {} : { order }),
  formatting: {},
  _build: { slug: name, srcdir: `../albums/${name}` },
});

describe("home page", () => {
  beforeEach(() => {
    mockGetAlbums.mockReset();
    mockGetImageTimestampRange.mockReset().mockImplementation(getTimestampRange);
  });

  it("renders the album collection", () => {
    const albums = [album("recent", [photo("one.jpg")])];

    render(<Home albums={albums} />);

    expect(screen.getByRole("heading", { name: "Snapshots" })).toBeInTheDocument();
    expect(screen.getByTestId("albums")).toHaveTextContent('"name":"recent"');
  });

  it("sorts albums and sends only deduplicated preview photos to the page", async () => {
    const cover = photo("cover.jpg", true);
    cover.id = undefined as never;
    cover._build.exif = {
      DateTimeOriginal: "2025-02-03T04:05:06",
      Orientation: "Rotate 90 CW",
      Model: "Heavy camera metadata",
    };
    cover._build.tags = {
      alt_text: "A useful cover description",
      colors: [[1, 2, 3]],
      tags: ["unused", "on", "home"],
      geocode: "Unused location metadata",
    };
    mockGetAlbums.mockResolvedValue([
      album("older", [text("intro"), photo("first.jpg")]),
      album("test-fixture", [photo("test.jpg")]),
      album("recent", [cover, photo("second.jpg")]),
      album("featured", [photo("first.jpg"), photo("hero.jpg", true)], 10),
      album("empty", [text("only-text")]),
    ]);

    const result = await loadHomePageData();
    expect(result.albums.map((album) => album.photoCount)).toEqual([2, 2, 1, 0, 1]);

    expect(result.albums.map(({ name }) => name)).toEqual([
      "featured",
      "recent",
      "older",
      "empty",
      "test-fixture",
    ]);
    expect(result.albums[0]?.blocks.map(({ id }) => id)).toEqual(["hero.jpg", "first.jpg"]);
    expect(result.albums[1]?.blocks.map(({ id }) => id)).toEqual(["cover.jpg"]);
    expect(result.albums[2]?.blocks.map(({ id }) => id)).toEqual(["first.jpg"]);
    expect(result.albums[3]?.blocks).toEqual([]);
    expect(result.albums[1]?._build.timeRange).toEqual(["2025-01-01", "2025-02-01"]);
    const previewCover = result.albums[1]?.blocks[0];
    expect(previewCover).toBeDefined();
    expect((previewCover as PhotoBlock)._build).toEqual({
      width: 100,
      height: 100,
      exif: {
        DateTimeOriginal: "2025-02-03T04:05:06",
        Orientation: "Rotate 90 CW",
      },
      tags: {
        alt_text: "A useful cover description",
        colors: [[1, 2, 3]],
      },
      srcset: [],
    });
  });

  // The album page shares the album as its first photograph when no cover is
  // marked. The card kept only the first piece of media, so an album opening on
  // a clip had a card showing the clip and a share image showing a photograph.
  it("keeps the block the album page takes for its cover", async () => {
    const full = album("opens-on-a-clip", [video("clip.mov"), photo("a.jpg"), photo("b.jpg")]);
    mockGetAlbums.mockResolvedValue([full]);

    const result = await loadHomePageData();

    expect(coverBlockOf(result.albums[0]!.blocks)?.id).toBe(coverBlockOf(full.blocks)?.id);
    expect(coverBlockOf(result.albums[0]!.blocks)?.id).toBe("a.jpg");
  });

  // A clip is media too: it counts, and its poster frame is what the card
  // draws, so an album of clips alone lands on the page with a cover.
  it("counts a clip and keeps its poster as the album's preview media", async () => {
    mockGetAlbums.mockResolvedValue([album("clips", [video("clip.mov")])]);

    const result = await loadHomePageData();

    expect(result.albums[0]?.photoCount).toBe(1);
    expect(result.albums[0]?.blocks).toEqual([
      {
        kind: "video",
        id: "clip.mov",
        data: { type: "local", href: "clip.mov" },
        _build: {
          src: "clip.mov@1920.mp4",
          mimeType: "video/mp4",
          poster: { srcset: [{ src: "clip.mov.avif", width: 100, height: 100 }] },
          capturedAtLocal: "2024-05-01T09:00:00",
          tags: {},
        },
      },
    ]);
  });
});
