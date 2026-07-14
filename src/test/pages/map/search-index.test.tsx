/**
 * @jest-environment jsdom
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { Content, PhotoBlock, TextBlock } from "../../../services/types";

jest.mock("../../../services/album", () => ({ getAlbums: jest.fn() }));
jest.mock("../../../services/buildTiming", () => ({
  measureBuild: (_name: string, work: () => unknown) => work(),
}));
jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import MapSearchIndexPage, { getStaticProps } from "../../../pages/map/search-index";

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

describe("map search data page", () => {
  it("renders only the no-index metadata shell", () => {
    expect(renderToStaticMarkup(<MapSearchIndexPage />)).toContain(
      '<meta name="robots" content="noindex, nofollow"/>',
    );
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

    await expect(getStaticProps({} as never)).resolves.toEqual({
      props: {
        entries: [["/album/singapore#night%20market.jpg", "Night market"]],
      },
    });
  });
});
