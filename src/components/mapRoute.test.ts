import { MapWorldEntry } from "./MapWorld";
import {
  ROUTE_SIMPLIFY_THRESHOLD,
  buildContextRouteGeoJson,
  buildMapRoute,
  getDefaultRouteMode,
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
    const manyPhotos = Array.from(
      { length: ROUTE_SIMPLIFY_THRESHOLD + 1 },
      (_, index) =>
        makePhoto({
          href: `/album/trip#${index}.jpg`,
          date: `2024-01-02T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
          decLat: 35 + index * 0.001,
          decLng: 139 + index * 0.001,
        }),
    );

    expect(getDefaultRouteMode(manyPhotos)).toBe("simplified");
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
});
