import {
  parseGpx,
  parseGoogleTakeout,
  normalizeTrack,
  sampleTrackAt,
  type TrackPoint,
} from "./gpsTrack";

const GPX = `<?xml version="1.0"?>
<gpx version="1.1"><trk><name>t</name><trkseg>
  <trkpt lat="35.0" lon="139.0"><ele>10</ele><time>2024-03-22T10:00:00Z</time></trkpt>
  <trkpt lat="35.1" lon="139.1"><time>2024-03-22T10:04:00Z</time></trkpt>
  <trkpt lat="35.2" lon="139.2"><time>2024-03-22T10:24:00Z</time></trkpt>
</trkseg></trk></gpx>`;

const at = (h: number, m: number) => Date.UTC(2024, 2, 22, h, m, 0);

describe("parseGpx", () => {
  it("parses trackpoints into sorted UTC points", () => {
    const track = parseGpx(GPX);
    expect(track.source).toBe("gpx");
    expect(track.points).toHaveLength(3);
    expect(track.points[0]).toMatchObject({ lat: 35.0, lng: 139.0, utcMs: at(10, 0), ele: 10 });
    expect(track.points[2].utcMs).toBe(at(10, 24));
  });
});

describe("parseGoogleTakeout", () => {
  it("parses the classic locations[] Records shape (E7 + timestampMs)", () => {
    const json = JSON.stringify({
      locations: [
        { latitudeE7: 350000000, longitudeE7: 1390000000, timestampMs: String(at(10, 0)) },
        { latitudeE7: 351000000, longitudeE7: 1391000000, timestamp: "2024-03-22T10:04:00Z" },
      ],
    });
    const track = parseGoogleTakeout(json);
    expect(track.source).toBe("takeout");
    expect(track.points).toHaveLength(2);
    expect(track.points[0]).toMatchObject({ lat: 35.0, lng: 139.0, utcMs: at(10, 0) });
    expect(track.points[1].utcMs).toBe(at(10, 4));
  });

  it("parses the newer semanticSegments/timelinePath shape", () => {
    const track = parseGoogleTakeout({
      semanticSegments: [
        {
          timelinePath: [
            { point: "35.0°, 139.0°", time: "2024-03-22T10:00:00Z" },
            { point: "35.1, 139.1", time: "2024-03-22T10:05:00Z" },
          ],
        },
      ],
    });
    expect(track.points).toHaveLength(2);
    expect(track.points[0]).toMatchObject({ lat: 35.0, lng: 139.0 });
  });
});

describe("normalizeTrack", () => {
  it("sorts, drops non-finite points, and dedupes identical timestamps", () => {
    const raw: TrackPoint[] = [
      { utcMs: at(10, 4), lat: 35.1, lng: 139.1 },
      { utcMs: at(10, 0), lat: 35.0, lng: 139.0 },
      { utcMs: at(10, 0), lat: 99, lng: 99 }, // duplicate ts → dropped
      { utcMs: Number.NaN, lat: 1, lng: 1 }, // invalid → dropped
    ];
    const track = normalizeTrack(raw, "gpx");
    expect(track.points.map((p) => p.utcMs)).toEqual([at(10, 0), at(10, 4)]);
    expect(track.points[0].lat).toBe(35.0);
  });
});

describe("sampleTrackAt", () => {
  const track = parseGpx(GPX);

  it("returns the exact point at high confidence", () => {
    expect(sampleTrackAt(track, at(10, 0))).toMatchObject({
      lat: 35.0,
      lng: 139.0,
      confidence: "high",
      gapMs: 0,
    });
  });

  it("interpolates within a short gap at high confidence", () => {
    const s = sampleTrackAt(track, at(10, 2))!; // midway across the 4-min leg
    expect(s.lat).toBeCloseTo(35.05, 6);
    expect(s.lng).toBeCloseTo(139.05, 6);
    expect(s.confidence).toBe("high");
  });

  it("drops to medium confidence across a longer gap", () => {
    const s = sampleTrackAt(track, at(10, 14))!; // midway across the 20-min leg
    expect(s.lat).toBeCloseTo(35.15, 6);
    expect(s.confidence).toBe("medium");
  });

  it("returns null outside the track's time span", () => {
    expect(sampleTrackAt(track, at(9, 0))).toBeNull();
    expect(sampleTrackAt(track, at(11, 0))).toBeNull();
  });

  it("interpolates across the antimeridian by the short way", () => {
    const anti = normalizeTrack(
      [
        { utcMs: 0, lat: 0, lng: 179 },
        { utcMs: 60_000, lat: 0, lng: -179 },
      ],
      "gpx",
    );
    const s = sampleTrackAt(anti, 30_000)!;
    expect(Math.abs(Math.abs(s.lng) - 180)).toBeLessThan(0.001); // ~±180, not ~0
    expect(s.lat).toBeCloseTo(0, 6);
  });
});
