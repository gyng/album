import { extractDateFromExifString, extractGPSFromExifString } from "./extractExifFromDb";

const gpsExif = (latitude: string, longitude: string, latRef = "N", lngRef = "E") =>
  [
    "GPS GPSLatitude: " + latitude,
    "GPS GPSLatitudeRef: " + latRef,
    "GPS GPSLongitude: " + longitude,
    "GPS GPSLongitudeRef: " + lngRef,
  ].join("\n");

describe("extractGPSFromExifString", () => {
  it("parses bracketed EXIF rationals and hemisphere references", () => {
    expect(extractGPSFromExifString(gpsExif("[36, 341/40, 0]", "[139, 30, 0]", "S", "W"))).toEqual([
      -(36 + 341 / 40 / 60),
      -139.5,
    ]);
  });

  it("parses comma-separated coordinates with fractions", () => {
    expect(extractGPSFromExifString(gpsExif("35, 30/1, 0", "139, 15/1, 0"))).toEqual([
      35.5, 139.25,
    ]);
  });

  it("parses degree/minute/second text", () => {
    const result = extractGPSFromExifString(gpsExif("35 deg 30' 30.0", "139 deg 15' 0.0"));
    expect(result?.[0]).toBeCloseTo(35.508333, 6);
    expect(result?.[1]).toBeCloseTo(139.25, 6);
  });

  it("parses space-separated coordinates with fractions", () => {
    expect(extractGPSFromExifString(gpsExif("35 30 0", "139 1/2 0"))).toEqual([
      35.5,
      139 + 0.5 / 60,
    ]);
  });

  it("returns null for missing, incomplete, malformed, and non-finite coordinates", () => {
    expect(extractGPSFromExifString("")).toBeNull();
    expect(extractGPSFromExifString("GPS GPSLatitude: [35, 0, 0]")).toBeNull();
    expect(extractGPSFromExifString(gpsExif("not coordinates", "139, 0, 0"))).toBeNull();
    expect(extractGPSFromExifString(gpsExif("[35, 0, 0", "139, 0, 0"))).toBeNull();
    expect(extractGPSFromExifString(gpsExif("][", "139, 0, 0"))).toBeNull();
    expect(extractGPSFromExifString(gpsExif("[35, 1/0, 0]", "[139, 0, 0]"))).toBeNull();
  });
});

describe("extractDateFromExifString", () => {
  it("constructs a Date from camera-local wall-clock components", () => {
    const date = extractDateFromExifString(
      "EXIF DateTimeOriginal: 2024:03:22 18:30:05\nEXIF OffsetTime: +09:00",
    );
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2024);
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(22);
    expect(date?.getHours()).toBe(18);
    expect(date?.getMinutes()).toBe(30);
    expect(date?.getSeconds()).toBe(5);
  });

  it("returns null for empty, missing, and malformed timestamps", () => {
    expect(extractDateFromExifString("")).toBeNull();
    expect(extractDateFromExifString("EXIF Make: Camera")).toBeNull();
    expect(extractDateFromExifString("EXIF DateTimeOriginal: not-a-date")).toBeNull();
  });
});
