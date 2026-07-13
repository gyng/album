import { buildExternalMapLinks, getMiddleDragCamera } from "./mapInteractions";

describe("mapInteractions", () => {
  it("maps middle-drag distance to bearing and clamped pitch", () => {
    expect(
      getMiddleDragCamera({
        startBearing: 170,
        startPitch: 40,
        deltaX: 100,
        deltaY: -200,
      }),
    ).toEqual({ bearing: 205, pitch: 60 });

    expect(
      getMiddleDragCamera({
        startBearing: 0,
        startPitch: 10,
        deltaX: -20,
        deltaY: 100,
      }),
    ).toEqual({ bearing: -7, pitch: 0 });
  });

  it("builds direct Google Maps and OpenStreetMap links for a coordinate", () => {
    expect(buildExternalMapLinks(22.3193, 114.1694)).toEqual({
      google: "https://www.google.com/maps/search/?api=1&query=22.3193%2C114.1694",
      osm: "https://www.openstreetmap.org/?mlat=22.3193&mlon=114.1694&zoom=13",
    });
  });
});
