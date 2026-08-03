/**
 * @jest-environment node
 */

import type { Trip } from "../util/computeTrips";
import {
  clusterStops,
  formatDayNumbers,
  projectRoute,
  routeFrameHeight,
  routeStops,
} from "./tripRoute";

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

describe("projectRoute", () => {
  const stop = (lat: number, lng: number) => ({ date: "d", number: 1, lat, lng, label: "" });

  it("fits the journey inside the frame, padding included", () => {
    const route = projectRoute([stop(35, 135), stop(34, 139)], 320, 240, 20);

    for (const point of route.points) {
      expect(point.x).toBeGreaterThanOrEqual(20);
      expect(point.x).toBeLessThanOrEqual(300);
      expect(point.y).toBeGreaterThanOrEqual(20);
      expect(point.y).toBeLessThanOrEqual(220);
    }
  });

  // One scale for both axes, or a north-south journey comes out looking like an
  // east-west one. North is up, as on any map.
  it("keeps the journey's own proportions, north upward", () => {
    const wide = projectRoute([stop(35, 130), stop(35, 140)], 320, 240, 0);
    const northward = projectRoute([stop(30, 135), stop(40, 135)], 320, 240, 0);

    expect(wide.points[1]!.x - wide.points[0]!.x).toBeCloseTo(320, 0);
    expect(northward.points[0]!.y - northward.points[1]!.y).toBeCloseTo(240, 0);
    expect(northward.points[1]!.y).toBeLessThan(northward.points[0]!.y);
  });

  it("draws a line through the stops in order", () => {
    const route = projectRoute([stop(35, 135), stop(34, 136), stop(33, 137)], 320, 240, 10);

    expect(route.path.startsWith("M")).toBe(true);
    expect(route.path.match(/L/g)).toHaveLength(2);
  });

  // Everything taken in one spot has no extent to divide by.
  it("centres a trip that never moved instead of dividing by nothing", () => {
    const route = projectRoute([stop(35, 135), stop(35, 135)], 320, 240, 10);

    expect(route.points[0]).toEqual({ x: 160, y: 120 });
  });

  // The markers are a clustered subset, so they have to be placed in the same
  // space as the line or they float off it.
  it("offers its own projection for anything else drawn in the frame", () => {
    const route = projectRoute([stop(35, 135), stop(34, 139)], 320, 240, 20);

    expect(route.project({ lat: 35, lng: 135 })).toEqual(route.points[0]);
  });
});

describe("a base returned to again and again", () => {
  // "1, 6, 7, 8, 11, 14" is wider than the marker it labels, and says less
  // than its own length does.
  it("counts the days rather than listing them once the list outgrows the pin", () => {
    expect(formatDayNumbers([1, 6, 7, 8, 11, 14])).toBe("6 days");
  });
});

describe("every photograph on the route", () => {
  const dayWith = (date: string, photos: Array<{ lat?: number; lng?: number; src?: string }>) =>
    ({
      date,
      count: photos.length,
      from: "09:00",
      to: "10:00",
      places: [],
      colour: null,
      hours: [],
      coveredKm: null,
      movedKm: null,
      point:
        photos[0] && photos[0].lat !== undefined
          ? { lat: photos[0].lat, lng: photos[0].lng }
          : null,
      photos: photos.map((p, i) => ({
        date,
        album: "a",
        src: p.src ?? `/${i}.avif`,
        href: "#",
        label: "",
        ...(p.lat !== undefined ? { lat: p.lat, lng: p.lng } : {}),
      })),
    }) as unknown as Trip["days"][number];

  // A day used to put one pin on the map however many frames it held, so a
  // six-photograph afternoon showed a single marker.
  it("gives every located photograph a stop, not every day", () => {
    const stops = routeStops(
      trip([
        dayWith("2016-11-13", [
          { lat: 35, lng: 135 },
          { lat: 35.2, lng: 135.2 },
          { lat: 35.4, lng: 135.4 },
        ]),
      ]),
    );

    expect(stops).toHaveLength(3);
  });

  it("labels each stop with the day it belongs to, so the numbering stays the journey's", () => {
    const stops = routeStops(
      trip([
        dayWith("2016-11-13", [
          { lat: 35, lng: 135 },
          { lat: 35.2, lng: 135.2 },
        ]),
        dayWith("2016-11-14", [{ lat: 36, lng: 136 }]),
      ]),
    );

    expect(stops.map((stop) => stop.number)).toEqual([1, 1, 2]);
  });

  it("skips photographs that never recorded where they were", () => {
    const stops = routeStops(trip([dayWith("2016-11-13", [{}, { lat: 35, lng: 135 }])]));

    expect(stops).toHaveLength(1);
  });

  // A cluster covering eight frames of one day should say "day 1", not "1" over
  // and over.
  it("names each day once however many of its frames a marker covers", () => {
    const markers = clusterStops(
      routeStops(
        trip([
          dayWith("2016-11-13", [
            { lat: 35, lng: 135 },
            { lat: 35.001, lng: 135.001 },
            { lat: 35.002, lng: 135 },
          ]),
          dayWith("2016-11-14", [{ lat: 40, lng: 135 }]),
        ]),
      ),
    );

    expect(markers[0]?.numbers).toEqual([1]);
    expect(markers[1]?.numbers).toEqual([2]);
  });
});

describe("routeFrameHeight", () => {
  const stop = (lat: number, lng: number) => ({ date: "d", number: 1, lat, lng, label: "" });

  // An east–west journey in a square frame is a thin line adrift in empty space.
  it("takes the journey's proportions rather than a fixed box", () => {
    const wide = routeFrameHeight([stop(35, 130), stop(35.2, 140)], 320, 20, 110, 280);
    const tall = routeFrameHeight([stop(30, 135), stop(40, 135.2)], 320, 20, 110, 280);

    expect(wide).toBeLessThan(tall);
  });

  it("stays within its limits however extreme the journey", () => {
    expect(routeFrameHeight([stop(35, 130), stop(35.001, 150)], 320, 20, 110, 280)).toBe(110);
    expect(routeFrameHeight([stop(10, 135), stop(60, 135.001)], 320, 20, 110, 280)).toBe(280);
  });

  it("falls back to the shortest frame for a journey with no extent at all", () => {
    expect(routeFrameHeight([stop(35, 135), stop(35, 135)], 320, 20, 110, 280)).toBe(110);
    expect(routeFrameHeight([], 320, 20, 110, 280)).toBe(110);
  });
});
