import {
  isValidLat,
  isValidLng,
  isValidFix,
  toExifGpsTags,
  buildWritePlan,
  type GpsFix,
} from "./gpsWriteModel";

describe("coordinate validation", () => {
  it("accepts in-range values and rejects out-of-range/non-finite", () => {
    expect(isValidLat(0)).toBe(true);
    expect(isValidLat(90)).toBe(true);
    expect(isValidLat(-90)).toBe(true);
    expect(isValidLat(90.1)).toBe(false);
    expect(isValidLat(Number.NaN)).toBe(false);
    expect(isValidLng(180)).toBe(true);
    expect(isValidLng(-180)).toBe(true);
    expect(isValidLng(180.1)).toBe(false);
    expect(isValidFix({ lat: 35.6, lng: 139.7 })).toBe(true);
    expect(isValidFix({ lat: 35.6, lng: 999 })).toBe(false);
  });
});

describe("toExifGpsTags", () => {
  it("maps a northern/eastern fix to absolute value + N/E refs", () => {
    const tags = toExifGpsTags({ lat: 35.681236, lng: 139.767125 });
    expect(tags.GPSLatitude).toBeCloseTo(35.681236, 6);
    expect(tags.GPSLatitudeRef).toBe("N");
    expect(tags.GPSLongitude).toBeCloseTo(139.767125, 6);
    expect(tags.GPSLongitudeRef).toBe("E");
    expect(tags.GPSProcessingMethod).toBeUndefined();
  });

  it("maps a southern/western fix to absolute value + S/W refs", () => {
    const tags = toExifGpsTags({ lat: -33.8688, lng: -151.2093 });
    expect(tags.GPSLatitude).toBeCloseTo(33.8688, 4);
    expect(tags.GPSLatitudeRef).toBe("S");
    expect(tags.GPSLongitude).toBeCloseTo(151.2093, 4);
    expect(tags.GPSLongitudeRef).toBe("W");
  });

  it("encodes altitude with a sea-level reference and marks interpolated fixes", () => {
    const tags = toExifGpsTags({ lat: 1, lng: 2, altitude: -12.5, interpolated: true });
    expect(tags.GPSAltitude).toBeCloseTo(12.5, 2);
    expect(tags.GPSAltitudeRef).toBe(1); // below sea level
    expect(tags.GPSProcessingMethod).toBe("INTERPOLATED");
  });

  it("marks positive altitude as above sea level", () => {
    const tags = toExifGpsTags({ lat: 1, lng: 2, altitude: 120 });
    expect(tags.GPSAltitude).toBe(120);
    expect(tags.GPSAltitudeRef).toBe(0);
  });

  it("throws on an invalid fix", () => {
    expect(() => toExifGpsTags({ lat: 99, lng: 0 })).toThrow();
  });
});

describe("buildWritePlan", () => {
  it("produces one diffable item per assignment, preserving before/after", () => {
    const assignments = [
      {
        filename: "a.jpg",
        path: "../albums/x/a.jpg",
        before: { lat: 1, lng: 2 },
        after: { lat: 35.6, lng: 139.7 } as GpsFix,
      },
      {
        filename: "b.jpg",
        path: "../albums/x/b.jpg",
        before: null,
        after: { lat: -1, lng: -2, interpolated: true } as GpsFix,
      },
    ];
    const plan = buildWritePlan(assignments);
    expect(plan).toHaveLength(2);
    expect(plan[0].tags.GPSLatitudeRef).toBe("N");
    expect(plan[0].before).toEqual({ lat: 1, lng: 2 });
    expect(plan[1].tags.GPSLatitudeRef).toBe("S");
    expect(plan[1].tags.GPSProcessingMethod).toBe("INTERPOLATED");
  });

  it("skips assignments whose target coordinates are invalid", () => {
    const plan = buildWritePlan([
      { filename: "bad.jpg", path: "p", before: null, after: { lat: 200, lng: 0 } },
    ]);
    expect(plan).toHaveLength(0);
  });
});
