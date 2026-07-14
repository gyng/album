import { convertDMSToDegree, getDegLatLngFromExif } from "./dms2deg";

describe("convertDMSToDegree", () => {
  it("converts three-part EXIF coordinates in both hemispheres", () => {
    expect(convertDMSToDegree([35, 30, 0], false)).toBe(35.5);
    expect(convertDMSToDegree([35, 30, 0], true)).toBe(-35.5);
  });

  it("rejects missing, incomplete, and non-finite EXIF coordinates", () => {
    expect(convertDMSToDegree(undefined, false)).toBeNull();
    expect(convertDMSToDegree([35, 30], false)).toBeNull();
    expect(convertDMSToDegree([35, Number.NaN, 0], false)).toBeNull();
  });
});

describe("getDegLatLngFromExif", () => {
  it("applies longitude and latitude reference directions", () => {
    expect(
      getDegLatLngFromExif({
        GPSLongitude: [151, 12, 33],
        GPSLongitudeRef: "W",
        GPSLatitude: [33, 52, 8],
        GPSLatitudeRef: "S",
      }),
    ).toEqual({
      decLng: -(151 + 12 / 60 + 33 / 3600),
      decLat: -(33 + 52 / 60 + 8 / 3600),
    });
  });
});
