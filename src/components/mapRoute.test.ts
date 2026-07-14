import { MapWorldEntry } from "./MapWorld";
import {
  ROUTE_SIMPLIFY_THRESHOLD,
  buildContextRouteGeoJson,
  buildContextRoutePoints,
  buildMapRoute,
  distanceMetersBetween,
  getDefaultRouteMode,
  toRouteGeoJson,
} from "./mapRoute";

const makePhoto = (
  overrides: Partial<MapWorldEntry> & Pick<MapWorldEntry, "href">,
): MapWorldEntry => ({
  album: "trip",
  src: { src: `${overrides.href}.jpg`, width: 100, height: 100 },
  decLat: 35,
  decLng: 139,
  date: "2024-01-02T00:00:00.000Z",
  placeholderColor: "transparent",
  placeholderWidth: 100,
  placeholderHeight: 100,
  ...overrides,
});

describe("mapRoute", () => {
  it("measures geographic distance and omits lines with fewer than two points", () => {
    expect(distanceMetersBetween({ decLat: 0, decLng: 0 }, { decLat: 0, decLng: 0 })).toBe(0);
    expect(distanceMetersBetween({ decLat: 0, decLng: 0 }, { decLat: 0, decLng: 1 })).toBeCloseTo(
      111_195,
      0,
    );
    expect(toRouteGeoJson([])).toBeNull();
    expect(
      toRouteGeoJson([
        {
          ...makePhoto({ href: "only" }),
          isStart: true,
          isEnd: true,
          sequenceIndex: 0,
          stopPhotoCount: 1,
          memberHrefs: ["only"],
        },
      ]),
    ).toBeNull();
  });

  it("sorts geotagged photos chronologically and marks endpoints", () => {
    const route = buildMapRoute([
      makePhoto({
        href: "/album/trip#late.jpg",
        date: "2024-01-03T00:00:00.000Z",
        decLat: 35.3,
        decLng: 139.3,
      }),
      makePhoto({
        href: "/album/trip#early.jpg",
        date: "2024-01-01T00:00:00.000Z",
        decLat: 35.1,
        decLng: 139.1,
      }),
      makePhoto({
        href: "/album/trip#missing-gps.jpg",
        decLat: null,
        decLng: null,
      }),
      makePhoto({
        href: "/album/trip#middle.jpg",
        date: "2024-01-02T00:00:00.000Z",
        decLat: 35.2,
        decLng: 139.2,
      }),
    ]);

    expect(route.geotaggedCount).toBe(3);
    expect(route.fullPoints.map((photo) => photo.href)).toEqual([
      "/album/trip#early.jpg",
      "/album/trip#middle.jpg",
      "/album/trip#late.jpg",
    ]);
    expect(route.fullPoints[0]?.isStart).toBe(true);
    expect(route.fullPoints[2]?.isEnd).toBe(true);
    expect(route.fullRouteGeoJson?.features[0]?.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [139.1, 35.1],
        [139.2, 35.2],
        [139.3, 35.3],
      ],
    });
  });

  it("collapses nearby consecutive photos into simplified stops", () => {
    const route = buildMapRoute(
      [
        makePhoto({
          href: "/album/trip#one.jpg",
          date: "2024-01-02T00:00:00.000Z",
          decLat: 35.0,
          decLng: 139.0,
        }),
        makePhoto({
          href: "/album/trip#two.jpg",
          date: "2024-01-02T00:10:00.000Z",
          decLat: 35.0002,
          decLng: 139.0002,
        }),
        makePhoto({
          href: "/album/trip#three.jpg",
          date: "2024-01-02T02:00:00.000Z",
          decLat: 35.5,
          decLng: 139.5,
        }),
      ],
      { nearbyDistanceMeters: 50, nearbyTimeWindowMs: 30 * 60 * 1000 },
    );

    expect(route.fullPoints).toHaveLength(3);
    expect(route.simplifiedPoints).toHaveLength(2);
    expect(route.simplifiedPoints[0]?.stopPhotoCount).toBe(2);
    expect(route.simplifiedPoints[1]?.stopPhotoCount).toBe(1);
    expect(route.simplifiedRouteGeoJson?.features[0]?.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [139, 35],
        [139.5, 35.5],
      ],
    });
  });

  it("recommends simplified mode for very dense albums", () => {
    const manyPhotos = Array.from({ length: ROUTE_SIMPLIFY_THRESHOLD + 1 }, (_, index) =>
      makePhoto({
        href: `/album/trip#${index}.jpg`,
        date: `2024-01-02T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
        decLat: 35 + index * 0.001,
        decLng: 139 + index * 0.001,
      }),
    );

    expect(getDefaultRouteMode(manyPhotos)).toBe("simplified");
    expect(getDefaultRouteMode(manyPhotos.slice(0, ROUTE_SIMPLIFY_THRESHOLD))).toBe("full");
    expect(
      getDefaultRouteMode([
        makePhoto({ href: "null-lat", decLat: null }),
        makePhoto({ href: "null-lng", decLng: null }),
        makePhoto({ href: "nan-lat", decLat: Number.NaN }),
        makePhoto({ href: "infinite-lng", decLng: Number.POSITIVE_INFINITY }),
      ]),
    ).toBe("full");
  });

  it("sorts equal, missing, and invalid timestamps stably after dated photos", () => {
    const route = buildMapRoute([
      makePhoto({ href: "undated-first", date: null }),
      makePhoto({ href: "dated-a", date: "2024-01-01T00:00:00" }),
      makePhoto({ href: "invalid", date: "not-a-date" }),
      makePhoto({ href: "dated-b", date: "2024-01-01T00:00:00" }),
      makePhoto({ href: "undated-last", date: null }),
    ]);

    expect(route.fullPoints.map(({ href }) => href)).toEqual([
      "dated-a",
      "dated-b",
      "undated-first",
      "invalid",
      "undated-last",
    ]);

    expect(
      buildMapRoute([
        makePhoto({ href: "dated", date: "2024-01-01T00:00:00" }),
        makePhoto({ href: "undated", date: null }),
      ]).fullPoints.map(({ href }) => href),
    ).toEqual(["dated", "undated"]);
  });

  it("builds a local context route around the selected photo within its album", () => {
    const photos = [
      makePhoto({
        href: "/album/trip#a.jpg",
        album: "trip",
        date: "2024-01-01T00:00:00.000Z",
        decLat: 35.0,
        decLng: 139.0,
      }),
      makePhoto({
        href: "/album/trip#b.jpg",
        album: "trip",
        date: "2024-01-01T00:10:00.000Z",
        decLat: 35.1,
        decLng: 139.1,
      }),
      makePhoto({
        href: "/album/trip#c.jpg",
        album: "trip",
        date: "2024-01-01T00:20:00.000Z",
        decLat: 35.2,
        decLng: 139.2,
      }),
      makePhoto({
        href: "/album/other#z.jpg",
        album: "other",
        date: "2024-01-04T00:00:00.000Z",
        decLat: 48.8,
        decLng: 2.3,
      }),
    ];

    expect(buildContextRouteGeoJson(photos, "/album/trip#b.jpg")).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            pointCount: 3,
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [139, 35],
              [139.1, 35.1],
              [139.2, 35.2],
            ],
          },
        },
      ],
    });
  });

  it("limits the context route to the contiguous trip segment", () => {
    const photos = [
      makePhoto({
        href: "/album/trip#a.jpg",
        album: "trip",
        date: "2024-01-01T08:00:00.000Z",
        decLat: 35.0,
        decLng: 139.0,
      }),
      makePhoto({
        href: "/album/trip#b.jpg",
        album: "trip",
        date: "2024-01-01T08:30:00.000Z",
        decLat: 35.01,
        decLng: 139.01,
      }),
      makePhoto({
        href: "/album/trip#c.jpg",
        album: "trip",
        date: "2024-01-01T11:30:00.000Z",
        decLat: 35.02,
        decLng: 139.02,
      }),
    ];

    expect(buildContextRouteGeoJson(photos, "/album/trip#a.jpg")).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            pointCount: 3,
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [139, 35],
              [139.01, 35.01],
              [139.02, 35.02],
            ],
          },
        },
      ],
    });
  });

  it("keeps same-day travel linked even with larger intra-day gaps", () => {
    const photos = [
      makePhoto({
        href: "/album/trip#a.jpg",
        album: "trip",
        date: "2024-01-01T08:00:00.000Z",
        decLat: 35.0,
        decLng: 139.0,
      }),
      makePhoto({
        href: "/album/trip#b.jpg",
        album: "trip",
        date: "2024-01-01T12:30:00.000Z",
        decLat: 35.5,
        decLng: 139.5,
      }),
      makePhoto({
        href: "/album/trip#c.jpg",
        album: "trip",
        date: "2024-01-02T09:00:00.000Z",
        decLat: 36.0,
        decLng: 140.0,
      }),
    ];

    expect(buildContextRouteGeoJson(photos, "/album/trip#b.jpg")).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            pointCount: 3,
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [139, 35],
              [139.5, 35.5],
              [140, 36],
            ],
          },
        },
      ],
    });
  });

  it("shows the whole route for trips that fit within three weeks", () => {
    const photos = [
      makePhoto({
        href: "/album/trip#a.jpg",
        album: "trip",
        date: "2024-01-01T08:00:00.000Z",
        decLat: 35.0,
        decLng: 139.0,
      }),
      makePhoto({
        href: "/album/trip#b.jpg",
        album: "trip",
        date: "2024-01-10T08:00:00.000Z",
        decLat: 35.5,
        decLng: 139.5,
      }),
      makePhoto({
        href: "/album/trip#c.jpg",
        album: "trip",
        date: "2024-01-18T08:00:00.000Z",
        decLat: 36.0,
        decLng: 140.0,
      }),
    ];

    expect(buildContextRouteGeoJson(photos, "/album/trip#b.jpg")).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            pointCount: 3,
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [139, 35],
              [139.5, 35.5],
              [140, 36],
            ],
          },
        },
      ],
    });
  });

  it("shows the whole route for trips a little over three weeks long", () => {
    const photos = [
      makePhoto({
        href: "/album/trip#a.jpg",
        album: "trip",
        date: "2024-01-01T08:00:00.000Z",
        decLat: 35.0,
        decLng: 139.0,
      }),
      makePhoto({
        href: "/album/trip#b.jpg",
        album: "trip",
        date: "2024-01-12T08:00:00.000Z",
        decLat: 35.5,
        decLng: 139.5,
      }),
      makePhoto({
        href: "/album/trip#c.jpg",
        album: "trip",
        date: "2024-01-24T08:00:00.000Z",
        decLat: 36.0,
        decLng: 140.0,
      }),
    ];

    expect(buildContextRouteGeoJson(photos, "/album/trip#b.jpg")).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            pointCount: 3,
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [139, 35],
              [139.5, 35.5],
              [140, 36],
            ],
          },
        },
      ],
    });
  });

  it("limits trips longer than 28 days to the target's local-day segment", () => {
    const photos = [
      makePhoto({ href: "day-one-a", date: "2024-01-01T08:00:00", decLat: 35, decLng: 139 }),
      makePhoto({
        href: "day-one-b",
        date: "2024-01-01T12:00:00",
        decLat: 35.1,
        decLng: 139.1,
      }),
      makePhoto({ href: "later", date: "2024-02-10T08:00:00", decLat: 36, decLng: 140 }),
    ];

    expect(buildContextRoutePoints(photos, "day-one-b")?.map(({ href }) => href)).toEqual([
      "day-one-a",
      "day-one-b",
    ]);
    expect(buildContextRouteGeoJson(photos, "day-one-b")?.features[0]?.properties).toEqual({
      pointCount: 2,
    });
  });

  it("falls back to standard timestamps when a valid date is not an EXIF format", () => {
    const photos = [
      makePhoto({
        href: "rfc-a",
        date: "Mon, 01 Jan 2024 08:00:00 GMT",
        decLat: 35,
        decLng: 139,
      }),
      makePhoto({
        href: "rfc-b",
        date: "Mon, 01 Jan 2024 12:00:00 GMT",
        decLat: 35.1,
        decLng: 139.1,
      }),
      makePhoto({
        href: "rfc-later",
        date: "Fri, 01 Mar 2024 08:00:00 GMT",
        decLat: 36,
        decLng: 140,
      }),
    ];

    expect(buildContextRoutePoints(photos, "rfc-a")?.map(({ href }) => href)).toEqual([
      "rfc-a",
      "rfc-b",
    ]);
  });

  it("handles undated, simplified, missing, and unlocated context targets", () => {
    const undated = [
      makePhoto({ href: "undated-a", date: null, decLat: 35, decLng: 139 }),
      makePhoto({ href: "undated-b", date: null, decLat: 35.1, decLng: 139.1 }),
    ];
    expect(buildContextRoutePoints(undated, "undated-a")?.map(({ href }) => href)).toEqual([
      "undated-a",
      "undated-b",
    ]);

    const close = [
      makePhoto({ href: "close-a", date: "2024-01-01T00:00:00", decLat: 35, decLng: 139 }),
      makePhoto({
        href: "close-b",
        date: "2024-01-01T00:01:00",
        decLat: 35.0001,
        decLng: 139.0001,
      }),
      makePhoto({
        href: "close-c",
        date: "2024-01-01T00:02:00",
        decLat: 35.0002,
        decLng: 139.0002,
      }),
    ];
    expect(buildContextRoutePoints(close, "close-b", "simplified")).toHaveLength(1);

    expect(buildContextRoutePoints(close, "missing")).toBeNull();
    expect(buildContextRouteGeoJson(close, "missing")).toBeNull();
    expect(
      buildContextRoutePoints(
        [makePhoto({ href: "unlocated", date: null, decLat: null, decLng: null })],
        "unlocated",
      ),
    ).toBeNull();
    expect(
      buildContextRouteGeoJson(
        [makePhoto({ href: "single", date: null, decLat: 35, decLng: 139 })],
        "single",
      ),
    ).toBeNull();
  });
});

describe("antimeridian route line", () => {
  it("unwraps GeoJSON longitudes so Pacific-crossing legs take the short way", () => {
    const route = buildMapRoute([
      makePhoto({
        href: "/album/trip#tokyo.jpg",
        date: "2024-01-01T00:00:00.000Z",
        decLat: 35,
        decLng: 179.5,
      }),
      makePhoto({
        href: "/album/trip#hawaii.jpg",
        date: "2024-01-02T00:00:00.000Z",
        decLat: 21,
        decLng: -179.5,
      }),
    ]);

    const coordinates = route.fullRouteGeoJson?.features[0]?.geometry.coordinates;
    // −179.5 unwraps to 180.5 (1° hop), not a 359° sweep the long way round
    expect(coordinates).toEqual([
      [179.5, 35],
      [180.5, 21],
    ]);
  });
});

describe("wall-clock day segments", () => {
  it("splits route days at the photo's local midnight, not the build zone's", () => {
    // Naive wall-clock timestamps (the build pipeline's serialisation):
    // 23:50 and 00:10 fall on different local days on ANY build machine
    const route = buildMapRoute([
      makePhoto({
        href: "/album/trip#night.jpg",
        date: "2024-01-01T23:50:00",
        decLat: 35.1,
        decLng: 139.1,
      }),
      makePhoto({
        href: "/album/trip#after-midnight.jpg",
        date: "2024-01-02T00:10:00",
        decLat: 35.2,
        decLng: 139.2,
      }),
      makePhoto({
        href: "/album/trip#much-later.jpg",
        date: "2024-02-10T12:00:00",
        decLat: 36,
        decLng: 140,
      }),
    ]);

    const contextPoints = buildContextRoutePoints(route.fullPoints, route.fullPoints[0]!.href);
    const context = buildContextRouteGeoJson(route.fullPoints, route.fullPoints[0]!.href);
    // Hovering the 23:50 photo must trace only its own day — one point,
    // so no line feature is produced for a single-photo segment
    expect(contextPoints?.map(({ href }) => href)).toEqual(["/album/trip#night.jpg"]);
    expect(context).toBeNull();
  });
});
