/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    // Each variant is encoded to "<newFile>.tmp-<pid>-<n>" then renamed into
    // place — never written directly to the final destination. The trailing
    // counter makes every variant's temp name unique even though they share
    // a pid (see the concurrent-calls test below for why that matters).
    expect(fs.renameSync).toHaveBeenCalledTimes(3);
    const tempNames = new Set<string>();
    for (const [tempArg, finalArg] of jest.mocked(fs.renameSync).mock.calls) {
      expect(String(tempArg)).toMatch(/\.avif\.tmp-\d+-\d+$/);
      expect(String(finalArg)).toMatch(/\.avif$/);
      expect(String(tempArg).startsWith(`${String(finalArg)}.tmp-${process.pid}-`)).toBe(true);
      tempNames.add(String(tempArg));
    }
    expect(tempNames.size).toBe(3);
  });

  it("spares fresh temp files from stray cleanup while removing stale ones, regardless of which pid created them", async () => {
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    jest.spyOn(fs, "renameSync").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const unlink = jest.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);

    const foreignPid = process.pid + 1;
    // Temp names now carry a per-attempt counter, so pid alone no longer
    // distinguishes "our own, presumably abandoned, earlier attempt" from "a
    // sibling variant this same process is still actively writing" — only
    // staleness does. Cover both a foreign pid and our own pid at both ages.
    const freshForeignTemp = `photo.jpg@800.avif.tmp-${foreignPid}-1`;
    const staleForeignTemp = `photo.jpg@1600.avif.tmp-${foreignPid}-2`;
    const freshOwnTemp = `photo.jpg@3200.avif.tmp-${process.pid}-1`;
    const staleOwnTemp = `photo.jpg@3200.avif.tmp-${process.pid}-2`;
    jest
      .spyOn(fs, "readdirSync")
      .mockReturnValue([freshForeignTemp, staleForeignTemp, freshOwnTemp, staleOwnTemp] as never);
    jest.spyOn(fs, "statSync").mockImplementation(
      (target) =>
        ({
          mtimeMs:
            String(target).endsWith(freshForeignTemp) || String(target).endsWith(freshOwnTemp)
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
    // A fresh temp file — whichever pid created it — may be mid-write by a
    // concurrent encoder (prepare:images alongside next dev, or another
    // in-flight variant of this very process); deleting it would make that
    // writer's renameSync throw ENOENT. Only genuinely stale entries go.
    expect(unlinked.some((target) => target.endsWith(freshForeignTemp))).toBe(false);
    expect(unlinked.some((target) => target.endsWith(staleForeignTemp))).toBe(true);
    expect(unlinked.some((target) => target.endsWith(freshOwnTemp))).toBe(false);
    expect(unlinked.some((target) => target.endsWith(staleOwnTemp))).toBe(true);
  });

  it("does not let two concurrent optimiseImages calls for the same photo delete each other's in-flight temp file", async () => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "photo-concurrent-temp-"));
    const outputDirectory = path.join(root, "public", "data", "albums");
    const photoPath = path.join(root, "albums", "trip", "photo.jpg");

    // The first call's encode writes to disk immediately (as sharp opening
    // and streaming into the destination as soon as toFile() is invoked
    // would) and then waits to be told when to settle, so its rename can be
    // timed precisely. The second call's own write is deliberately held back
    // until after the first call's rename has already been attempted —
    // reproducing the worst-case interleaving of the same-process race
    // deterministically (real concurrent requests could plausibly interleave
    // this way; a fixed setTimeout delay could not force it reliably).
    let resolveFirstCall!: () => void;
    const firstCallGate = new Promise<void>((resolve) => {
      resolveFirstCall = resolve;
    });
    let resolveSecondCallStart!: () => void;
    const secondCallStartGate = new Promise<void>((resolve) => {
      resolveSecondCallStart = resolve;
    });

    let pipelineCount = 0;
    mockSharp.mockImplementation(() => {
      const isFirstCall = pipelineCount === 0;
      pipelineCount += 1;
      const toFile = jest.fn(async (tempPath: string) => {
        if (isFirstCall) {
          fs.writeFileSync(tempPath, "generated");
          await firstCallGate;
        } else {
          await secondCallStartGate;
          fs.writeFileSync(tempPath, "generated");
        }
        return { width: 800, height: 600 };
      });
      const avif = jest.fn(() => ({ toFile }));
      const withIccProfile = jest.fn(() => ({ avif }));
      const resize = jest.fn(() => ({ withIccProfile }));
      const pipeline = { resize };
      const clone = jest.fn(() => pipeline);
      const rotate = jest.fn(() => ({ ...pipeline, clone }));
      return { rotate } as never;
    });

    // Both calls' entirely-synchronous setup (cleanup pass + temp-file-name
    // computation for every variant) runs to completion before either yields
    // to the event loop, so no extra scheduling is needed between them to
    // reach this point: the second call's cleanup pass already ran while the
    // first call's temp files were on disk and fresh.
    const firstCall = optimiseImages(photoPath, outputDirectory);
    const secondCall = optimiseImages(photoPath, outputDirectory);

    resolveFirstCall();
    // Flush every pending microtask (the toFile resolution, then its
    // .then()/.catch() rename handler) so the first call's rename attempt —
    // success or ENOENT — has already happened before the second call is
    // allowed to touch disk.
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveSecondCallStart();

    await expect(Promise.all([firstCall, secondCall])).resolves.toBeDefined();

    const resizedDir = path.join(outputDirectory, "trip", RESIZED_IMAGE_DIR);
    const leftoverTempFiles = fs.readdirSync(resizedDir).filter((name) => name.includes(".tmp-"));
    expect(leftoverTempFiles).toEqual([]);
    for (const size of OPTIMISED_SIZES) {
      expect(fs.existsSync(path.join(resizedDir, `photo.jpg@${size}.avif`))).toBe(true);
    }
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

    await expect(optimiseImages("albums/trip/photo.jpg", "public/data/albums")).rejects.toBe(
      failure,
    );

    expect(unlink).toHaveBeenCalledTimes(3);
    for (const [tempArg] of unlink.mock.calls) {
      expect(String(tempArg)).toMatch(/\.avif\.tmp-\d+-\d+$/);
    }
  });
});
