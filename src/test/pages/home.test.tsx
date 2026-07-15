/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { Content, PhotoBlock, TextBlock } from "../../services/types";

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

import Home, { getStaticProps } from "../../pages/index";

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

    const result = (await getStaticProps({} as never)) as { props: { albums: Content[] } };

    expect(result.props.albums.map(({ name }) => name)).toEqual([
      "featured",
      "recent",
      "older",
      "empty",
      "test-fixture",
    ]);
    expect(result.props.albums[0]?.blocks.map(({ id }) => id)).toEqual(["hero.jpg", "first.jpg"]);
    expect(result.props.albums[1]?.blocks.map(({ id }) => id)).toEqual(["cover.jpg"]);
    expect(result.props.albums[2]?.blocks.map(({ id }) => id)).toEqual(["first.jpg"]);
    expect(result.props.albums[3]?.blocks).toEqual([]);
    expect(result.props.albums[1]?._build.timeRange).toEqual(["2025-01-01", "2025-02-01"]);
    const previewCover = result.props.albums[1]?.blocks[0];
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
});
