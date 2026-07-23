import type { PhotoBlock, TextBlock } from "../services/types";
import {
  buildMapPhotoSearchText,
  fetchMapSearchIndex,
  getMapPhotoHref,
  hasMapCoordinates,
} from "./mapSearchIndex";

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

  it("normalises array tags, removes non-text values, and encodes photo filenames", () => {
    const richPhoto: PhotoBlock = {
      ...photo,
      data: {
        src: "../albums/hong-kong/night market.jpg",
        title: "Night market",
        kicker: "Kowloon",
        description: "  ",
      },
      _build: {
        ...photo._build,
        tags: {
          tags: ["street", 42, "food"] as unknown as string[],
        },
      },
    };

    expect(buildMapPhotoSearchText(richPhoto)).toBe(
      "Night market Kowloon street food X-T5 NOKTON 35mm F1.2",
    );
    expect(getMapPhotoHref("hong-kong", richPhoto)).toBe("/album/hong-kong#night%20market.jpg");

    delete richPhoto._build.tags.tags;
    expect(buildMapPhotoSearchText(richPhoto)).toBe("Night market Kowloon X-T5 NOKTON 35mm F1.2");
  });

  it("accepts only photos with a complete coordinate tuple", () => {
    const text: TextBlock = { kind: "text", id: "text", data: { title: "Text" } };
    expect(hasMapCoordinates(text)).toBe(false);

    const candidate: PhotoBlock = {
      ...photo,
      _build: { ...photo._build, exif: {} },
    };
    expect(hasMapCoordinates(candidate)).toBe(false);
    candidate._build.exif.GPSLongitude = [114, 10, 0];
    expect(hasMapCoordinates(candidate)).toBe(false);
    candidate._build.exif.GPSLatitude = [22, 18, 0];
    expect(hasMapCoordinates(candidate)).toBe(false);
    candidate._build.exif.GPSLongitudeRef = "E";
    expect(hasMapCoordinates(candidate)).toBe(false);
    candidate._build.exif.GPSLatitudeRef = "N";
    expect(hasMapCoordinates(candidate)).toBe(true);
  });

  it("fetches and validates the stable public data endpoint", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [
          ["/album/hong-kong#cat.jpg", "cute cat"],
          ["bad"],
          "not-a-tuple",
          [42, "numeric href"],
          ["/valid-href", 42],
        ],
      }),
    });

    await expect(fetchMapSearchIndex(fetcher)).resolves.toEqual(
      new Map([["/album/hong-kong#cat.jpg", "cute cat"]]),
    );
    expect(fetcher).toHaveBeenCalledWith("/data/map-search-index.json", { cache: "no-store" });
  });

  it("returns an empty index for a payload without an entries array", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await expect(fetchMapSearchIndex(fetcher)).resolves.toEqual(new Map());
  });

  it("reports static-data response failures with and without a status code", async () => {
    await expect(
      fetchMapSearchIndex(
        jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
      ),
    ).rejects.toThrow("Failed to load map search index (503)");

    await expect(
      fetchMapSearchIndex(jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) })),
    ).rejects.toThrow("Failed to load map search index (unknown)");
  });

  it("uses the browser fetch implementation by default", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ entries: [["/photo", "search text"]] }),
    } as Response);

    await expect(fetchMapSearchIndex()).resolves.toEqual(new Map([["/photo", "search text"]]));
    fetchSpy.mockRestore();
  });
});
