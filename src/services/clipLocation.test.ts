import { inferClipLocation, reconcileInferredLocation } from "./clipLocation";

const photo = (name: string, capturedAtLocal: string, latDeg = 35.66, lngDeg = 139.73) => ({
  name,
  capturedAtLocal,
  latDeg,
  lngDeg,
});

describe("inferClipLocation", () => {
  // A clip is almost always shot between photographs, by the same person, in
  // the same place: the nearest geotagged frame in time is where it was.
  it("takes the place of the geotagged photograph nearest in time", () => {
    expect(
      inferClipLocation("2025-12-01T20:15:51", [
        photo("before.jpg", "2025:12:01 20:11:00", 1, 2),
        photo("after.jpg", "2025:12:01 20:18:30", 3, 4),
        photo("long-before.jpg", "2025:12:01 18:00:00", 5, 6),
      ]),
    ).toEqual({ latDeg: 3, lngDeg: 4, photo: "after.jpg", minutesApart: 3 });
  });

  it("says how far before the clip a photograph was taken", () => {
    expect(
      inferClipLocation("2025-12-01T20:15:51", [photo("before.jpg", "2025:12:01 20:11:00")])
        ?.minutesApart,
    ).toBe(-5);
  });

  // Beyond half an hour the photographer may have moved anywhere; a guessed
  // pin is worse than no pin.
  it("infers nothing from a photograph more than half an hour away", () => {
    expect(
      inferClipLocation("2025-12-01T20:15:51", [photo("later.jpg", "2025:12:01 20:46:00")]),
    ).toBeUndefined();
  });

  it("infers nothing without a wall clock to compare", () => {
    expect(inferClipLocation(undefined, [photo("a.jpg", "2025:12:01 20:15:00")])).toBeUndefined();
    expect(
      inferClipLocation("2025-12-01T20:15:51", [photo("a.jpg", "not a date")]),
    ).toBeUndefined();
  });
});

describe("reconcileInferredLocation", () => {
  const nearby = [photo("near.jpg", "2025:12:01 20:20:00", 1.28, 103.85)];

  // The camera's own fix is a measurement; an inference never replaces it.
  it("leaves a location the camera recorded alone", () => {
    const sidecar = {
      mediaKind: "video" as const,
      capturedAtLocal: "2025-12-01T20:15:51",
      latDeg: 35,
      lngDeg: 139,
      locationSource: "camera" as const,
    };
    expect(reconcileInferredLocation(sidecar, nearby)).toBe(sidecar);
  });

  it("fills a clip without a location from the nearest photograph, saying so", () => {
    expect(
      reconcileInferredLocation(
        { mediaKind: "video", capturedAtLocal: "2025-12-01T20:15:51" },
        nearby,
      ),
    ).toEqual({
      mediaKind: "video",
      capturedAtLocal: "2025-12-01T20:15:51",
      latDeg: 1.28,
      lngDeg: 103.85,
      locationSource: "nearby-photo",
      locationInferredFrom: { photo: "near.jpg", minutesApart: 4 },
    });
  });

  // Re-checked on every run, so an inference follows the photographs: one
  // whose source photo lost its fix, or moved away in time, goes.
  it("withdraws an inference the photographs no longer support", () => {
    expect(
      reconcileInferredLocation(
        {
          mediaKind: "video",
          capturedAtLocal: "2025-12-01T20:15:51",
          latDeg: 1.28,
          lngDeg: 103.85,
          locationSource: "nearby-photo",
          locationInferredFrom: { photo: "near.jpg", minutesApart: 4 },
        },
        [],
      ),
    ).toEqual({ mediaKind: "video", capturedAtLocal: "2025-12-01T20:15:51" });
  });

  it("returns the same object when nothing changed, so nothing is rewritten", () => {
    const inferred = reconcileInferredLocation(
      { mediaKind: "video", capturedAtLocal: "2025-12-01T20:15:51" },
      nearby,
    );
    expect(reconcileInferredLocation(inferred, nearby)).toBe(inferred);
  });
});
