/**
 * @jest-environment node
 */

import type { Trip } from "../util/computeTrips";
import { fitToRoute, routeBounds, routeStops } from "./tripRoute";

const day = (over: Partial<Trip["days"][number]>): Trip["days"][number] => ({
  date: "2016-11-13",
  count: 1,
  from: "09:00",
  to: "10:00",
  places: [],
  photos: [],
  colour: null,
  hours: [],
  coveredKm: null,
  movedKm: null,
  point: null,
  ...over,
});

const trip = (days: Trip["days"]): Trip => ({ id: "t", days, places: [] }) as unknown as Trip;

describe("routeStops", () => {
  // The numbers are positions in the route, not day numbers: a day with no
  // located photograph cannot be drawn, and numbering around it would leave the
  // reader looking for a missing stop 2.
  it("numbers only the days it can place, consecutively", () => {
    const stops = routeStops(
      trip([
        day({ date: "2016-11-13", point: { lat: 35, lng: 135 } }),
        day({ date: "2016-11-14" }),
        day({ date: "2016-11-15", point: { lat: 34, lng: 136 } }),
      ]),
    );

    expect(stops.map((stop) => [stop.date, stop.number])).toEqual([
      ["2016-11-13", 1],
      ["2016-11-15", 2],
    ]);
  });

  it("takes the day's first frame as its picture, where there is one", () => {
    const stops = routeStops(
      trip([
        day({
          point: { lat: 35, lng: 135 },
          photos: [{ src: "/one.avif" }, { src: "/two.avif" }] as Trip["days"][number]["photos"],
        }),
      ]),
    );

    expect(stops[0]?.src).toBe("/one.avif");
  });
});

describe("routeBounds", () => {
  it("encloses every stop", () => {
    expect(
      routeBounds([
        { date: "a", number: 1, lat: 35, lng: 139, label: "" },
        { date: "b", number: 2, lat: 34, lng: 135, label: "" },
      ]),
    ).toEqual([
      { lng: 135, lat: 34 },
      { lng: 139, lat: 35 },
    ]);
  });

  it("has nothing to enclose when the trip was never located", () => {
    expect(routeBounds([])).toBeNull();
  });
});

describe("fitToRoute", () => {
  const camera = () => ({ fitBounds: jest.fn(), jumpTo: jest.fn() });

  it("frames the whole journey when there is more than one stop", () => {
    const map = camera();

    fitToRoute(map as never, [
      { date: "a", number: 1, lat: 35, lng: 139, label: "" },
      { date: "b", number: 2, lat: 34, lng: 135, label: "" },
    ]);

    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        { lng: 135, lat: 34 },
        { lng: 139, lat: 35 },
      ],
      expect.objectContaining({ padding: expect.any(Number) }),
    );
    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  // Bounds enclosing one point are a point, which fits at maximum zoom.
  it("jumps to a readable zoom when a trip never left one place", () => {
    const map = camera();

    fitToRoute(map as never, [{ date: "a", number: 1, lat: 35, lng: 139, label: "" }]);

    expect(map.jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: { lng: 139, lat: 35 } }),
    );
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("does nothing at all when there is no stop to frame", () => {
    const map = camera();

    fitToRoute(map as never, []);

    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
  });
});
