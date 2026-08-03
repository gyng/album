/**
 * @jest-environment node
 */

import type { Trip } from "../util/computeTrips";
import { clusterStops, fitToRoute, formatDayNumbers, routeBounds, routeStops } from "./tripRoute";

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
      expect.objectContaining({
        // The picture stands above its pin, so the top needs room the bottom
        // does not — a stop near the top edge otherwise loses its photograph.
        padding: expect.objectContaining({ top: expect.any(Number), bottom: expect.any(Number) }),
      }),
    );
    const { padding } = map.fitBounds.mock.calls[0][1];
    expect(padding.top).toBeGreaterThan(padding.bottom);
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

describe("clusterStops", () => {
  const stop = (number: number, lat: number, lng: number, src?: string) => ({
    date: `2016-11-${String(12 + number).padStart(2, "0")}`,
    number,
    lat,
    lng,
    label: "",
    ...(src ? { src } : {}),
  });

  // Nine of one real trip's fourteen markers sat on top of another, so only
  // five days were visible at all.
  it("gathers days that would land on the same pixel into one marker", () => {
    const markers = clusterStops([
      stop(1, 35.0, 135.0),
      stop(2, 35.001, 135.001),
      stop(3, 35.002, 135.0),
      stop(4, 36.5, 137.0),
    ]);

    expect(markers).toHaveLength(2);
    expect(markers[0]?.numbers).toEqual([1, 2, 3]);
    expect(markers[1]?.numbers).toEqual([4]);
  });

  // The tolerance is a fraction of the trip's own extent because the map is
  // fitted to that extent: the same two coordinates overlap on a city map and
  // are far apart on a country one.
  it("keeps the same two stops apart when the trip they belong to is small", () => {
    const wide = clusterStops([stop(1, 35.0, 135.0), stop(2, 35.05, 135.0), stop(3, 40.0, 135.0)]);
    const tight = clusterStops([stop(1, 35.0, 135.0), stop(2, 35.05, 135.0)]);

    expect(wide[0]?.numbers).toEqual([1, 2]);
    expect(tight).toHaveLength(2);
  });

  it("takes its picture from the first day in the group that has one", () => {
    // A third stop well away gives the trip an extent, which is what the
    // tolerance is measured against.
    const markers = clusterStops([
      stop(1, 35, 135),
      stop(2, 35.001, 135, "/two.avif"),
      stop(3, 40, 135, "/three.avif"),
    ]);

    expect(markers[0]?.numbers).toEqual([1, 2]);
    expect(markers[0]?.src).toBe("/two.avif");
  });

  it("has nothing to cluster when the trip was never located", () => {
    expect(clusterStops([])).toEqual([]);
  });
});

describe("formatDayNumbers", () => {
  it("reads a run as a range and a gap as a list", () => {
    expect(formatDayNumbers([6])).toBe("6");
    expect(formatDayNumbers([6, 7, 8])).toBe("6–8");
    expect(formatDayNumbers([6, 8])).toBe("6, 8");
  });

  it("does not depend on the order they arrived in", () => {
    expect(formatDayNumbers([8, 6, 7])).toBe("6–8");
  });
});

describe("a base returned to again and again", () => {
  // "1, 6, 7, 8, 11, 14" is wider than the marker it labels, and says less
  // than its own length does.
  it("counts the days rather than listing them once the list outgrows the pin", () => {
    expect(formatDayNumbers([1, 6, 7, 8, 11, 14])).toBe("6 days");
  });
});
