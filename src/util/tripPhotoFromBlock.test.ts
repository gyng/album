import type { Content, PhotoBlock } from "../services/types";
import { tripPhotoFromBlock } from "./tripPhotoFromBlock";

const album = { _build: { slug: "kansai" } } as Content;

const block = (over: Partial<PhotoBlock["_build"]> = {}): PhotoBlock =>
  ({
    kind: "photo",
    id: "a.jpg",
    data: { src: "a.jpg" },
    _build: {
      exif: { DateTimeOriginal: "2024:05:01 09:00:00" },
      srcset: [{ src: "/a.avif", width: 1, height: 1 }],
      tags: {},
      width: 1,
      height: 1,
      ...over,
    },
  }) as unknown as PhotoBlock;

describe("tripPhotoFromBlock", () => {
  it("carries the body and lens the camera recorded", () => {
    const photo = tripPhotoFromBlock(
      album,
      block({
        exif: { DateTimeOriginal: "2024:05:01 09:00:00", Model: "X-T5", LensModel: "XF27" },
      }),
    );

    expect(photo).toMatchObject({ camera: "X-T5", lens: "XF27" });
  });

  // A fixed-lens body records no LensModel, and half this archive is one. The
  // field must be absent rather than empty, so gear shares count only what was
  // actually recorded.
  it("omits the lens entirely when the camera recorded none", () => {
    const photo = tripPhotoFromBlock(
      album,
      block({ exif: { DateTimeOriginal: "2024:05:01 09:00:00", Model: "X100T" } }),
    );

    expect(photo.lens).toBeUndefined();
    expect("lens" in photo).toBe(false);
  });

  // The index stores tags as one comma-separated column and the row arrives
  // unparsed, despite the type saying string[].
  it("reads tags whether they arrive as a list or as one comma-separated string", () => {
    const fromString = tripPhotoFromBlock(
      album,
      block({ tags: { tags: "moss, stone lantern" as unknown as string[] } }),
    );
    const fromList = tripPhotoFromBlock(
      album,
      block({ tags: { tags: ["moss", "stone lantern"] } }),
    );

    expect(fromString.tags).toEqual(["moss", "stone lantern"]);
    expect(fromList.tags).toEqual(["moss", "stone lantern"]);
  });

  it("omits tags when the photograph has none", () => {
    expect(tripPhotoFromBlock(album, block()).tags).toBeUndefined();
  });
});
