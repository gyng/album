/**
 * @jest-environment node
 */

import fs from "node:fs";

jest.mock("image-size/fromFile", () => ({ imageSizeFromFile: jest.fn() }));
jest.mock("exifr", () => ({
  __esModule: true,
  default: { parse: jest.fn() },
}));
jest.mock("sharp", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("./buildTiming", () => ({
  incrementBuildCounter: jest.fn(),
  measureBuild: (_name: string, work: () => unknown) => work(),
  measureBuildSync: (_name: string, work: () => unknown) => work(),
}));

import exifr from "exifr";
import { imageSizeFromFile } from "image-size/fromFile";
import sharp from "sharp";
import {
  AVIF_OPTIONS,
  getNextJsSafeExif,
  getPhotoSize,
  optimiseImages,
  OPTIMISED_SIZES,
  RESIZED_IMAGE_DIR,
} from "./photo";

const mockExifParse = jest.mocked(exifr.parse);
const mockImageSize = jest.mocked(imageSizeFromFile);
const mockSharp = jest.mocked(sharp);

const successfulEncoder = (width = 800, height = 600) => ({
  rotate: () => ({
    resize: () => ({
      avif: () => ({
        toFile: async () => ({ width, height }),
      }),
    }),
  }),
});

describe("photo adapter boundaries", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockExifParse.mockReset();
    mockImageSize.mockReset();
    mockSharp.mockReset();
  });

  it("uses the production image variants and AVIF settings", () => {
    expect(OPTIMISED_SIZES).toEqual([3200, 1600, 800]);
    expect(RESIZED_IMAGE_DIR).toBe(".resized_images");
    expect(AVIF_OPTIONS).toEqual({ quality: 75, effort: 2 });
  });

  it("normalises missing dimensions from the image adapter", async () => {
    mockImageSize.mockResolvedValue({ width: undefined, height: undefined, type: "jpg" });

    await expect(getPhotoSize("photo.jpg")).resolves.toEqual({ width: 0, height: 0 });
  });

  it("serialises EXIF dates as camera-local values and tolerates parser failures", async () => {
    mockExifParse.mockResolvedValueOnce({
      DateTimeOriginal: new Date(2024, 3, 7, 12, 34, 56),
      Model: "X-T5",
    });

    await expect(getNextJsSafeExif("photo.jpg")).resolves.toMatchObject({
      DateTimeOriginal: "2024-04-07T12:34:56",
      Model: "X-T5",
    });

    mockExifParse.mockRejectedValueOnce(new Error("invalid EXIF"));
    await expect(getNextJsSafeExif("broken.jpg")).resolves.toEqual({});
  });

  it("re-encodes zero-byte cache entries", async () => {
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "statSync").mockReturnValue({ size: 0 } as fs.Stats);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    mockSharp.mockImplementation(() => successfulEncoder() as never);

    const results = await optimiseImages("albums/trip/photo.jpg", "public/data/albums");

    expect(results).toHaveLength(3);
    expect(results.every(({ width, height }) => width === 800 && height === 600)).toBe(true);
  });

  it.each([
    ["unreadable", () => Promise.reject(new Error("bad cache"))],
    ["missing dimensions", () => Promise.resolve({ width: 0, height: 600 })],
  ])("re-encodes cache entries with %s metadata", async (_label, metadata) => {
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "statSync").mockReturnValue({ size: 10 } as fs.Stats);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    mockSharp.mockImplementation((input) => {
      if (String(input).includes("@")) {
        return { metadata } as never;
      }
      return successfulEncoder() as never;
    });

    await expect(
      optimiseImages("albums/trip/photo.jpg", "public/data/albums"),
    ).resolves.toHaveLength(3);
  });

  it("reports and rethrows encoder failures", async () => {
    const failure = new Error("encoder failed");
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockSharp.mockImplementation(
      () =>
        ({
          rotate: () => ({
            resize: () => ({
              avif: () => ({ toFile: async () => Promise.reject(failure) }),
            }),
          }),
        }) as never,
    );

    await expect(optimiseImages("albums/trip/photo.jpg", "public/data/albums")).rejects.toBe(
      failure,
    );
    expect(error).toHaveBeenCalledWith("Failed to optimise albums/trip/photo.jpg");
  });
});
