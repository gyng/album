import { albumNeighbours, fetchAlbumPreviews } from "./albumNeighbours";
import type { AlbumPreview } from "./pageDataTypes";

const album = (slug: string): AlbumPreview => ({
  name: slug,
  title: slug,
  blocks: [],
  formatting: {},
  _build: { slug, srcdir: `../albums/${slug}` },
});
const albums = ["newest", "middle", "oldest"].map(album);

describe("albumNeighbours", () => {
  it("gives an album the ones either side of it", () => {
    const { previous, next } = albumNeighbours(albums, "middle");
    expect(previous?.name).toBe("newest");
    expect(next?.name).toBe("oldest");
  });

  it("leaves out a neighbour past either end, and an unknown album has none", () => {
    expect(albumNeighbours(albums, "newest")).not.toHaveProperty("previous");
    expect(albumNeighbours(albums, "oldest")).not.toHaveProperty("next");
    expect(albumNeighbours(albums, "missing")).toEqual({});
  });
});

describe("fetchAlbumPreviews", () => {
  it("asks past any stored copy and drops malformed entries", async () => {
    const fetcher = jest.fn(async () =>
      Response.json({ albums: [albums[0], { title: "no build" }, null] }),
    );
    expect((await fetchAlbumPreviews(fetcher)).map((each) => each.name)).toEqual(["newest"]);
    expect(fetcher).toHaveBeenCalledWith("/data/albums.json", { cache: "no-store" });
  });

  it("fails loudly on a bad response", async () => {
    await expect(fetchAlbumPreviews(async () => new Response("", { status: 500 }))).rejects.toThrow(
      "500",
    );
  });
});
