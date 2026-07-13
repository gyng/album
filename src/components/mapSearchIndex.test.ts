import type { PhotoBlock } from "../services/types";
import { buildMapPhotoSearchText, fetchMapSearchIndex, getMapPhotoHref } from "./mapSearchIndex";

const photo = {
  kind: "photo",
  id: "cat.jpg",
  data: { src: "../albums/hong-kong/cat.jpg", description: "A market cat" },
  _build: {
    height: 100,
    width: 100,
    exif: { Model: "X-T5", LensModel: "NOKTON 35mm F1.2" },
    tags: {
      // Legacy indexes occasionally serialised this as a scalar.
      tags: "cute fuzzy animal" as unknown as string[],
      alt_text: "A tabby beside a fruit stall",
      geocode: "Hong Kong",
    },
    srcset: [],
  },
} satisfies PhotoBlock;

describe("mapSearchIndex", () => {
  it("builds a compact corpus from captions, tags, place and gear", () => {
    expect(buildMapPhotoSearchText(photo)).toBe(
      "A market cat cute fuzzy animal A tabby beside a fruit stall Hong Kong X-T5 NOKTON 35mm F1.2",
    );
    expect(getMapPhotoHref("hong-kong", photo)).toBe("/album/hong-kong#cat.jpg");
  });

  it("fetches and validates the separate static Next data chunk", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pageProps: {
          entries: [["/album/hong-kong#cat.jpg", "cute cat"], ["bad"]],
        },
      }),
    });

    await expect(fetchMapSearchIndex("build/hash", fetcher)).resolves.toEqual(
      new Map([["/album/hong-kong#cat.jpg", "cute cat"]]),
    );
    expect(fetcher).toHaveBeenCalledWith("/_next/data/build%2Fhash/map/search-index.json");
  });
});
