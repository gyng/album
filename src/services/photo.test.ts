/**
 * @jest-environment node
 */

import { monkeyExif } from "../test/fixtures/monkey_exif";
import {
  getNextJsSafeExif,
  getPhotoSize,
  optimiseImages,
  stripPublicFromPath,
} from "./photo";

describe("photo utilities", () => {
  describe("getPhotoSize", () => {
    it("gets dimensions of a photo", async () => {
      const input = "test/fixtures/monkey.jpg";
      const actual = await getPhotoSize(input);
      expect(actual).toEqual({ height: 50, width: 34 });
    });

    it("defaults to 100 x 100 for bad images", async () => {
      const input = "test/fixtures/missing.jpg";
      const actual = await getPhotoSize(input);
      expect(actual).toEqual({ height: 100, width: 100 });
    });
  });

  describe("getNextJsSafeExif", () => {
    it("gets an EXIF object safe for Next.js", async () => {
      const input = "test/fixtures/monkey.jpg";
      // EXIF dates don't actually have timezones and this fails on CI
      const actual = await getNextJsSafeExif(input);
      const expected = monkeyExif;
      actual.CreateDate = expected.CreateDate;
      actual.ModifyDate = expected.ModifyDate;
      actual.DateTimeOriginal = expected.DateTimeOriginal;
      expect(actual).toEqual(expected);
    });
  });

  describe("optimiseImages", () => {
    it("skips cached/already-optimised images", async () => {
      const actual = await optimiseImages(
        "test/fixtures/monkey.jpg",
        "fixtures",
      );
      expect(actual).toEqual([
        {
          src: "/fixtures/.resized_images/monkey.jpg@800.avif",
          width: 800,
          height: 1176,
        },
        {
          src: "/fixtures/.resized_images/monkey.jpg@1600.avif",
          width: 1600,
          height: 2353,
        },
        {
          src: "/fixtures/.resized_images/monkey.jpg@3200.avif",
          width: 3200,
          height: 4706,
        },
      ]);
    });

    // Note that this test is minimal/incomplete as an implementation shortcut
    // it assumes that file will exist if the promise resolves
    // Also, this test does not work as intended when running locally
    // as images will have been cached. It will fail on CI.
    it("optimised unoptimised images", async () => {
      const actual = await optimiseImages(
        "test/fixtures/monkey-for-unoptimised.jpg",
        "fixtures",
      );
      expect(actual).toEqual([
        {
          src: "/fixtures/.resized_images/monkey-for-unoptimised.jpg@800.avif",
          width: 800,
          height: 1176,
        },
        {
          src: "/fixtures/.resized_images/monkey-for-unoptimised.jpg@1600.avif",
          width: 1600,
          height: 2353,
        },
        {
          src: "/fixtures/.resized_images/monkey-for-unoptimised.jpg@3200.avif",
          width: 3200,
          height: 4706,
        },
      ]);
    }, 120000);
  });

  describe("stripPublicFromPath", () => {
    it("strips the first segment from paths", () => {
      const input = "public/data/albums/abc/1.jpg";
      const actual = stripPublicFromPath(input);
      const expected = "/data/albums/abc/1.jpg";
      expect(actual).toBe(expected);
    });
  });
});
