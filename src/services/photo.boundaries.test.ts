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
  ICC_PROFILE,
  optimiseImages,
  OPTIMISED_SIZES,
  RESIZED_IMAGE_DIR,
} from "./photo";

const mockExifParse = jest.mocked(exifr.parse);
const mockImageSize = jest.mocked(imageSizeFromFile);
const mockSharp = jest.mocked(sharp);

const successfulEncoder = (width = 800, height = 600) => {
  const outputPipeline = {
    resize: () => ({
      withIccProfile: () => ({
        avif: () => ({
          toFile: async () => ({ width, height }),
        }),
      }),
    }),
  };
  return {
    rotate: () => ({
      clone: () => outputPipeline,
    }),
  };
};

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
    expect(AVIF_OPTIONS).toEqual({
      quality: 85,
      effort: 2,
      tune: "iq",
      chromaSubsampling: "4:4:4",
    });
    expect(ICC_PROFILE).toBe("srgb");
  });

  it("shares one source pipeline across generated variants, encoding atomically via a temp file rename", async () => {
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    jest.spyOn(fs, "renameSync").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    const toFile = jest.fn(async () => ({ width: 800, height: 600 }));
    const avif = jest.fn(() => ({ toFile }));
    const withIccProfile = jest.fn(() => ({ avif }));
    const resize = jest.fn(() => ({ withIccProfile }));
    const pipeline = { resize };
    const clone = jest.fn(() => pipeline);
    const rotate = jest.fn(() => ({ ...pipeline, clone }));
    mockSharp.mockReturnValue({ rotate } as never);

    await expect(
      optimiseImages("albums/trip/photo.jpg", "public/data/albums"),
    ).resolves.toHaveLength(3);

    expect(mockSharp).toHaveBeenCalledTimes(1);
    expect(mockSharp).toHaveBeenCalledWith("albums/trip/photo.jpg");
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(clone).toHaveBeenCalledTimes(3);
    expect(resize).toHaveBeenCalledTimes(3);
    expect(withIccProfile).toHaveBeenCalledTimes(3);
    expect(withIccProfile).toHaveBeenCalledWith(ICC_PROFILE);
    expect(avif).toHaveBeenCalledTimes(3);
    expect(avif).toHaveBeenCalledWith(AVIF_OPTIONS);
    expect(fs.mkdirSync).toHaveBeenCalledTimes(1);
    // Each variant is encoded to "<newFile>.tmp-<pid>" then renamed into
    // place — never written directly to the final destination.
    expect(fs.renameSync).toHaveBeenCalledTimes(3);
    for (const [tempArg, finalArg] of jest.mocked(fs.renameSync).mock.calls) {
      expect(String(tempArg)).toMatch(/\.avif\.tmp-\d+$/);
      expect(String(finalArg)).toMatch(/\.avif$/);
      expect(String(tempArg)).toBe(`${String(finalArg)}.tmp-${process.pid}`);
    }
  });

  it("spares a fresh foreign-pid temp file from stray cleanup while removing stale ones", async () => {
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    jest.spyOn(fs, "renameSync").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const unlink = jest.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);

    const foreignPid = process.pid + 1;
    const freshForeignTemp = `photo.jpg@800.avif.tmp-${foreignPid}`;
    const staleForeignTemp = `photo.jpg@1600.avif.tmp-${foreignPid}`;
    const ownTemp = `photo.jpg@3200.avif.tmp-${process.pid}`;
    jest
      .spyOn(fs, "readdirSync")
      .mockReturnValue([freshForeignTemp, staleForeignTemp, ownTemp] as never);
    jest.spyOn(fs, "statSync").mockImplementation(
      (target) =>
        ({
          mtimeMs: String(target).endsWith(freshForeignTemp)
            ? Date.now()
            : Date.now() - 60 * 60 * 1000,
        }) as fs.Stats,
    );

    const toFile = jest.fn(async () => ({ width: 800, height: 600 }));
    const avif = jest.fn(() => ({ toFile }));
    const withIccProfile = jest.fn(() => ({ avif }));
    const resize = jest.fn(() => ({ withIccProfile }));
    const pipeline = { resize };
    const clone = jest.fn(() => pipeline);
    const rotate = jest.fn(() => ({ ...pipeline, clone }));
    mockSharp.mockReturnValue({ rotate } as never);

    await optimiseImages("albums/trip/photo.jpg", "public/data/albums");

    const unlinked = unlink.mock.calls.map(([target]) => String(target));
    // A fresh foreign-pid temp may be mid-write by a concurrent encoder
    // (prepare:images alongside next dev) — deleting it would make that
    // writer's renameSync throw ENOENT.
    expect(unlinked.some((target) => target.endsWith(freshForeignTemp))).toBe(false);
    expect(unlinked.some((target) => target.endsWith(staleForeignTemp))).toBe(true);
    expect(unlinked.some((target) => target.endsWith(ownTemp))).toBe(true);
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
    jest.spyOn(fs, "renameSync").mockImplementation(() => undefined);
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
    jest.spyOn(fs, "renameSync").mockImplementation(() => undefined);
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
            clone: () => ({
              resize: () => ({
                withIccProfile: () => ({
                  avif: () => ({ toFile: async () => Promise.reject(failure) }),
                }),
              }),
            }),
          }),
        }) as never,
    );

    await expect(optimiseImages("albums/trip/photo.jpg", "public/data/albums")).rejects.toBe(
      failure,
    );
    expect(error).toHaveBeenCalledWith("Failed to optimise albums/trip/photo.jpg");
  });

  it("cleans up the partial temp file when the encoder fails", async () => {
    const failure = new Error("encoder failed");
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const unlink = jest.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);
    mockSharp.mockImplementation(
      () =>
        ({
          rotate: () => ({
            clone: () => ({
              resize: () => ({
                withIccProfile: () => ({
                  avif: () => ({ toFile: async () => Promise.reject(failure) }),
                }),
              }),
            }),
          }),
        }) as never,
    );

    await expect(
      optimiseImages("albums/trip/photo.jpg", "public/data/albums"),
    ).rejects.toBe(failure);

    expect(unlink).toHaveBeenCalledTimes(3);
    for (const [tempArg] of unlink.mock.calls) {
      expect(String(tempArg)).toMatch(/\.avif\.tmp-\d+$/);
    }
  });
});
