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
      const actual = await getNextJsSafeExif(input);
      const expected = {
        ImageWidth: 1743,
        ImageHeight: 2615,
        BitsPerSample: { "0": 8, "1": 8, "2": 8 },
        PhotometricInterpretation: 2,
        Make: "FUJIFILM",
        Model: "X100T",
        Orientation: "Horizontal (normal)",
        SamplesPerPixel: 3,
        XResolution: 300,
        YResolution: 300,
        ResolutionUnit: "inches",
        Software: "Adobe Photoshop 23.1 (Windows)",
        ModifyDate: "2023-07-17T14:16:50.000Z",
        ExposureTime: 0.008,
        FNumber: 4,
        ExposureProgram: "Aperture priority",
        ISO: 3200,
        SensitivityType: 1,
        ExifVersion: "2.3",
        DateTimeOriginal: "2020-10-19T05:23:13.000Z",
        CreateDate: "2020-10-18T21:23:13.000Z",
        ShutterSpeedValue: 6.965784,
        ApertureValue: 4,
        BrightnessValue: 4.06,
        ExposureCompensation: 0,
        MaxApertureValue: 2,
        MeteringMode: "Pattern",
        LightSource: "Unknown",
        Flash: "Flash did not fire, compulsory flash mode",
        FocalLength: 23,
        ColorSpace: 65535,
        ExifImageWidth: 34,
        ExifImageHeight: 50,
        FocalPlaneXResolution: 2083.423126220703,
        FocalPlaneYResolution: 2083.423126220703,
        FocalPlaneResolutionUnit: "Centimeter",
        SensingMethod: "One-chip color area sensor",
        FileSource: "Digital Camera",
        SceneType: "Directly photographed",
        CustomRendered: "Normal",
        ExposureMode: "Auto",
        WhiteBalance: "Auto",
        SceneCaptureType: "Standard",
        Sharpness: "Normal",
        SubjectDistanceRange: "Unknown",
        GPSVersionID: "2.3.0.0",
        GPSLatitudeRef: "N",
        GPSLatitude: [1, 22.289, 0],
        GPSLongitudeRef: "E",
        GPSLongitude: [103, 46.932, 0],
        GPSAltitudeRef: { "0": 0 },
        GPSAltitude: 0,
        GPSTimeStamp: "5:23:13",
        GPSDateStamp: "2020:10:19",
        latitude: 1.3714833333333334,
        longitude: 103.7822,
      };
      expect(actual).toEqual(expected);
    });
  });

  describe("optimiseImages", () => {
    it("skips cached/already-optimised images", async () => {
      const actual = await optimiseImages("test/fixtures/monkey.jpg");
      expect(actual).toEqual([
        {
          src: "/fixtures/.resized_images/monkey.jpg@800.webp",
          width: 800,
        },
        {
          src: "/fixtures/.resized_images/monkey.jpg@1200.webp",
          width: 1200,
        },
        {
          src: "/fixtures/.resized_images/monkey.jpg@2400.webp",
          width: 2400,
        },
        {
          src: "/fixtures/.resized_images/monkey.jpg@4896.webp",
          width: 4896,
        },
      ]);
    });

    // Note that this test is minimal/incomplete as an implementation shortcut
    // it assumes that file will exist if the promise resolves
    // Also, this test does not work as intended when running locally
    // as images will have been cached. It will fail on CI.
    it("optimised unoptimised images", async () => {
      const actual = await optimiseImages(
        "test/fixtures/monkey-for-unoptimised.jpg"
      );
      expect(actual).toEqual([
        {
          src: "/fixtures/.resized_images/monkey-for-unoptimised.jpg@800.webp",
          width: 800,
        },
        {
          src: "/fixtures/.resized_images/monkey-for-unoptimised.jpg@1200.webp",
          width: 1200,
        },
        {
          src: "/fixtures/.resized_images/monkey-for-unoptimised.jpg@2400.webp",
          width: 2400,
        },
        {
          src: "/fixtures/.resized_images/monkey-for-unoptimised.jpg@4896.webp",
          width: 4896,
        },
      ]);
    }, 30000);
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
