import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gpsFixUtcMs, listFolder } from "./folders.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEST_SIMPLE = path.resolve(here, "../../../albums/test-simple");

describe("gpsFixUtcMs", () => {
  it("combines GPSDateStamp + GPSTimeStamp into a UTC millisecond count", () => {
    expect(gpsFixUtcMs({ GPSDateStamp: "2024:03:22", GPSTimeStamp: [10, 30, 0] })).toBe(
      Date.UTC(2024, 2, 22, 10, 30, 0),
    );
  });

  it("returns null when the fix time is absent or malformed", () => {
    expect(gpsFixUtcMs({})).toBeNull();
    expect(gpsFixUtcMs({ GPSDateStamp: "2024:03:22" })).toBeNull();
    expect(gpsFixUtcMs({ GPSTimeStamp: [1, 2, 3] })).toBeNull();
  });
});

describe("listFolder", () => {
  it("lists a directory's photos with decoded GPS + naive wall-clock date", async () => {
    const listing = await listFolder(TEST_SIMPLE);
    expect(listing.path).toBe(TEST_SIMPLE);
    expect(listing.photos.length).toBeGreaterThan(0);

    const p = listing.photos.find((x) => x.filename === "DSCF0506-2.jpg");
    expect(p).toBeDefined();
    expect(p!.decLat).toBeCloseTo(36.5789, 3);
    expect(p!.decLng).toBeCloseTo(137.596, 3);
    expect(p!.dateTimeOriginal).toBe("2019-11-06T10:48:19");
    expect(p).toHaveProperty("lensModel");
    expect(p).toHaveProperty("focalLength");
  });

  it("rejects a path that does not exist", async () => {
    await expect(listFolder("/no/such/dir/xyz-geotag")).rejects.toThrow();
  });
});
