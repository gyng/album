import { deserializeContentBlock } from "./deserialize";
import { serializeContentBlock } from "./serialize";
import { Content, SerializedContent } from "./types";

describe("serialization", () => {
  const content: Content = {
    name: "foo",
    title: "bar",
    blocks: [
      {
        kind: "photo",
        id: "foo",
        data: {
          src: "test/fixtures/monkey.jpg",
        },
        _build: {
          height: 100,
          width: 100,
          exif: {},
          srcset: [
            { src: "monkey.optimised.jpg", width: 100 },
            { src: "monkey.optimised.2.jpg", width: 100 },
          ],
        },
      },
    ],
    formatting: {
      overlay: undefined,
    },
    _build: {
      slug: "slug",
      timeRange: [0, 1000],
      srcdir: "srcdir",
    },
  };

  const serializedContent: SerializedContent = {
    blocks: [
      {
        data: { src: "test/fixtures/monkey.jpg" },
        id: "foo",
        kind: "photo",
      },
    ],
    name: "foo",
    title: "bar",
    formatting: {
      overlay: undefined,
    },
  };

  const fullyDeserializedContent: Content = {
    blocks: [
      {
        data: { src: "/fixtures/monkey.jpg" },
        id: "foo",
        kind: "photo",
        formatting: { cover: false },
        _build: {
          srcset: [
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
          ],
          exif: {
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
          },
          width: 34,
          height: 50,
        },
      },
    ],
    name: "foo",
    title: "bar",
    formatting: {},
    _build: { slug: "foo", srcdir: "." },
  };

  it("serializes a Content object", () => {
    const input: Content = content;
    const actual = serializeContentBlock(input);
    const expected: SerializedContent = serializedContent;
    expect(actual).toEqual(expected);
  });

  it("deserializes a SerializedContent object", async () => {
    const input: SerializedContent = serializedContent;
    const actual = await deserializeContentBlock(input, ".");
    const expected: Content = fullyDeserializedContent;
    expect(actual).toEqual(expected);
    // First run will optimise images: webp optimisation takes a while
    // We keep optimised images in .resized_iamges
  }, 10000);
});
