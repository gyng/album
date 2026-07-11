import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGpx } from "@shared/gpsTrack";
import { interpolatePhotos, suggestSegmentOffset } from "./interpolate.ts";
import type { GeotagPhoto } from "./api.ts";

const GPX = `<gpx><trk><trkseg>
<trkpt lat="35.0" lon="139.0"><time>2024-03-22T10:00:00Z</time></trkpt>
<trkpt lat="35.2" lon="139.2"><time>2024-03-22T10:10:00Z</time></trkpt>
</trkseg></trk></gpx>`;

const photo = (over: Partial<GeotagPhoto> = {}): GeotagPhoto => ({
  filename: "p.jpg",
  path: "/x/p.jpg",
  dateTimeOriginal: "2024-03-22T19:05:00", // 10:05Z at +09:00 — mid-leg
  offsetTimeOriginal: null,
  decLat: null,
  decLng: null,
  gpsUtcMs: null,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("interpolatePhotos", () => {
  it("places a photo mid-leg using the segment offset", () => {
    const fixes = interpolatePhotos([photo()], parseGpx(GPX), 540);
    expect(fixes["p.jpg"].lat).toBeCloseTo(35.1, 6);
    expect(fixes["p.jpg"].confidence).toBe("medium");
    expect(fixes["p.jpg"].interpolated).toBe(true);
  });

  it("prefers a photo's own OffsetTimeOriginal over the segment offset", () => {
    const fixes = interpolatePhotos([photo({ offsetTimeOriginal: "+09:00" })], parseGpx(GPX), 0);
    expect(fixes["p.jpg"]?.lat).toBeCloseTo(35.1, 6);
  });

  it("skips photos outside the track's span", () => {
    // offset 0 → 19:05Z, well after the track ends (10:10Z) → no fix
    const fixes = interpolatePhotos([photo()], parseGpx(GPX), 0);
    expect(fixes["p.jpg"]).toBeUndefined();
  });
});

describe("suggestSegmentOffset", () => {
  it("returns the exif offset when a photo has OffsetTimeOriginal (no server call)", async () => {
    const res = await suggestSegmentOffset([photo({ offsetTimeOriginal: "+09:00" })], parseGpx(GPX));
    expect(res).toEqual({ offsetMinutes: 540, source: "exif-offsettime" });
  });

  it("falls back to the track-location timezone via fetchTz", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ zone: "Asia/Tokyo" }) })),
    );
    const res = await suggestSegmentOffset([photo()], parseGpx(GPX));
    expect(res).toEqual({ offsetMinutes: 540, source: "track-timezone" });
  });
});
