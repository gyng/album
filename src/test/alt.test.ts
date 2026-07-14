/**
 * @jest-environment node
 */

import { getPhotoAltText } from "../lib/alt";
import { PhotoBlock } from "../services/types";

const buildBlock = (overrides: Partial<PhotoBlock> = {}): PhotoBlock => ({
  kind: "photo",
  id: "photo-1",
  data: {
    src: "albums/tokyo/IMG_1234.JPG",
    ...overrides.data,
  },
  _build: {
    width: 1200,
    height: 800,
    exif: {},
    tags: {},
    srcset: [{ src: "/IMG_1234.avif", width: 1200, height: 800 }],
    ...overrides._build,
  },
  ...overrides,
});

describe("getPhotoAltText", () => {
  it("prefers explicit alt text metadata", () => {
    expect(
      getPhotoAltText(
        buildBlock({
          _build: {
            width: 1200,
            height: 800,
            exif: {},
            tags: { alt_text: "Night skyline over the river" },
            srcset: [{ src: "/IMG_1234.avif", width: 1200, height: 800 }],
          },
        }),
      ),
    ).toBe("Night skyline over the river");
  });

  it("falls back to the photo title when present", () => {
    expect(
      getPhotoAltText(
        buildBlock({
          data: {
            src: "albums/tokyo/IMG_1234.JPG",
            title: "Shibuya crossing at dusk",
          },
        }),
      ),
    ).toBe("Shibuya crossing at dusk");
  });

  it("builds a readable fallback from filename and capture date", () => {
    expect(
      getPhotoAltText(
        buildBlock({
          data: {
            src: "albums/tokyo/shibuya-crossing.jpg",
          },
          _build: {
            width: 1200,
            height: 800,
            exif: { DateTimeOriginal: "2024-04-07T12:34:56.000Z" },
            tags: {},
            srcset: [{ src: "/shibuya-crossing.avif", width: 1200, height: 800 }],
          },
        }),
      ),
    ).toBe("shibuya crossing, April 7, 2024");
  });

  it("uses a humanised filename when the capture date is unavailable", () => {
    expect(
      getPhotoAltText(
        buildBlock({
          data: { src: "albums/tokyo/night_train.JPG" },
          _build: {
            width: 1200,
            height: 800,
            exif: { DateTimeOriginal: "not-a-camera-date" },
            tags: {},
            srcset: [{ src: "/night_train.avif", width: 1200, height: 800 }],
          },
        }),
      ),
    ).toBe("night train");
  });

  it("combines the provided fallback with a capture date when no filename is available", () => {
    expect(
      getPhotoAltText(
        buildBlock({
          data: { src: "" },
          _build: {
            width: 1200,
            height: 800,
            exif: { DateTimeOriginal: "2024-04-07T12:34:56" },
            tags: {},
            srcset: [],
          },
        }),
        "Slideshow photo",
      ),
    ).toBe("Slideshow photo, April 7, 2024");
  });

  it("normalises whitespace and follows the editorial fallback order", () => {
    expect(
      getPhotoAltText(
        buildBlock({
          data: {
            src: "photo.jpg",
            title: "   ",
            kicker: "  Morning\n light  ",
            description: "A later fallback",
          },
          _build: {
            width: 1200,
            height: 800,
            exif: {},
            tags: { alt_text: "\t" },
            srcset: [],
          },
        }),
      ),
    ).toBe("Morning light");
  });

  it("uses the provided fallback when no metadata is available", () => {
    expect(
      getPhotoAltText(
        buildBlock({
          data: { src: "" },
        }),
        "Slideshow photo",
      ),
    ).toBe("Slideshow photo");
  });

  it("ignores filenames that contain only separators", () => {
    expect(getPhotoAltText(buildBlock({ data: { src: "---.jpg" } }), "Photo fallback")).toBe(
      "Photo fallback",
    );
  });
});
