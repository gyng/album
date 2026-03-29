/**
 * @jest-environment node
 */

export {};

const getAlbumFromName = jest.fn();
const getAlbumNames = jest.fn();
const removeStaleImages = jest.fn();
const removeStaleVideos = jest.fn();

jest.mock("../../../services/album", () => ({
  getAlbumFromName,
  getAlbumNames,
}));

jest.mock("../../../services/photo", () => ({
  removeStaleImages,
}));

jest.mock("../../../services/video", () => ({
  removeStaleVideos,
}));

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../../components/Nav", () => ({
  Nav: () => null,
}));

jest.mock("../../../components/PhotoAlbum", () => ({
  PhotoAlbum: () => null,
}));

const {
  getStaticProps: getAlbumPageStaticProps,
  getStaticPaths,
} = require("../../../pages/album/[[...slug]]");

describe("album page data fetching", () => {
  beforeEach(() => {
    getAlbumFromName.mockReset();
    getAlbumNames.mockReset();
    removeStaleImages.mockReset();
    removeStaleVideos.mockReset();
  });

  it("returns album props without running cleanup side effects", async () => {
    const album = {
      name: "trip",
      title: "trip",
      blocks: [],
      formatting: {},
      _build: { slug: "trip", srcdir: "../albums/trip" },
    };
    getAlbumFromName.mockResolvedValue(album);

    const actual = await getAlbumPageStaticProps({ params: { slug: ["trip"] } });

    expect(actual).toEqual({ props: { album } });
    expect(removeStaleImages).not.toHaveBeenCalled();
    expect(removeStaleVideos).not.toHaveBeenCalled();
  });

  it("still resolves album paths", async () => {
    getAlbumNames.mockResolvedValue(["trip", "holiday"]);

    const actual = await getStaticPaths({});

    expect(actual).toEqual({
      paths: ["/album/trip", "/album/holiday"],
      fallback: true,
    });
  });
});
