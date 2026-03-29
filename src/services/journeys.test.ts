import { Content } from "./types";
import {
  buildJourneys,
  JourneyEnrichmentOverrides,
  loadJourneyEnrichmentOverrides,
} from "./journeys";

const buildAlbum = (overrides: Partial<Content>): Content => {
  return {
    name: "trip",
    title: "Trip",
    blocks: [],
    formatting: {},
    _build: {
      slug: "trip",
      srcdir: "../albums/trip",
    },
    ...overrides,
  };
};

describe("buildJourneys", () => {
  it("derives journeys and stops from geotagged album photos", () => {
    const albums: Content[] = [
      buildAlbum({
        name: "japan",
        title: "Japan Winter Loop",
        _build: {
          slug: "japan",
          srcdir: "../albums/japan",
        },
        blocks: [
          {
            kind: "photo",
            id: "a.jpg",
            data: { src: "a.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-01-01T08:00:00.000Z",
                GPSLatitude: [35, 40, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [139, 41, 0],
                GPSLongitudeRef: "E",
              },
              tags: {
                geocode: "Tokyo, Japan",
                colors: [[10, 20, 30]],
              },
              srcset: [{ src: "/a@800.avif", width: 1200, height: 800 }],
            },
          },
          {
            kind: "photo",
            id: "b.jpg",
            data: { src: "b.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-01-01T08:30:00.000Z",
                GPSLatitude: [35, 40, 0.2],
                GPSLatitudeRef: "N",
                GPSLongitude: [139, 41, 0.2],
                GPSLongitudeRef: "E",
              },
              tags: {
                geocode: "Tokyo, Japan",
                colors: [[15, 25, 35]],
              },
              srcset: [{ src: "/b@800.avif", width: 1200, height: 800 }],
            },
          },
          {
            kind: "photo",
            id: "c.jpg",
            data: { src: "c.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-01-03T10:00:00.000Z",
                GPSLatitude: [34, 41, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [135, 30, 0],
                GPSLongitudeRef: "E",
              },
              tags: {
                geocode: "Osaka, Japan",
                colors: [[40, 50, 60]],
              },
              srcset: [{ src: "/c@800.avif", width: 1200, height: 800 }],
            },
          },
        ],
      }),
    ];

    const journeys = buildJourneys(albums);

    expect(journeys).toHaveLength(1);
    expect(journeys[0]).toMatchObject({
      albumSlug: "japan",
      albumCount: 1,
      title: "Tokyo to Osaka",
      stopCount: 2,
      geotaggedPhotoCount: 3,
      startPlace: "Tokyo",
      endPlace: "Osaka",
    });
    expect(journeys[0]?.summary).toContain("2 stops");
    expect(journeys[0]?.distanceKm).toBeGreaterThan(300);
    expect(journeys[0]?.memberHrefs).toEqual([
      "/album/japan#a.jpg",
      "/album/japan#b.jpg",
      "/album/japan#c.jpg",
    ]);
    expect(journeys[0]?.stops[0]).toMatchObject({
      title: "Tokyo",
      photoCount: 2,
      coverHref: "/album/japan#a.jpg",
    });
    expect(journeys[0]?.stops[1]?.title).toBe("Osaka");
  });

  it("applies enrichment overrides to journeys and stops", () => {
    const albums: Content[] = [
      buildAlbum({
        name: "trip",
        title: "Trip",
        _build: {
          slug: "trip",
          srcdir: "../albums/trip",
        },
        blocks: [
          {
            kind: "photo",
            id: "a.jpg",
            data: { src: "a.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-01-01T08:00:00.000Z",
                GPSLatitude: [35, 40, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [139, 41, 0],
                GPSLongitudeRef: "E",
              },
              tags: { geocode: "Tokyo, Japan", colors: [[10, 20, 30]] },
              srcset: [{ src: "/a@800.avif", width: 1200, height: 800 }],
            },
          },
          {
            kind: "photo",
            id: "b.jpg",
            data: { src: "b.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-01-02T08:00:00.000Z",
                GPSLatitude: [34, 41, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [135, 30, 0],
                GPSLongitudeRef: "E",
              },
              tags: { geocode: "Osaka, Japan", colors: [[40, 50, 60]] },
              srcset: [{ src: "/b@800.avif", width: 1200, height: 800 }],
            },
          },
        ],
      }),
    ];

    const overrides: JourneyEnrichmentOverrides = {
      journeys: {
        "2024-01-01:trip:a-jpg": {
          title: "Urban Winter Drift",
          summary: "A city-to-city winter line.",
          tags: ["city", "winter"],
        },
      },
      stops: {
        "2024-01-01:trip:a-jpg:0": {
          title: "Tokyo Arrival",
          summary: "First city morning.",
          tags: ["arrival"],
        },
      },
    };

    const journeys = buildJourneys(albums, { enrichmentOverrides: overrides });

    expect(journeys[0]?.title).toBe("Urban Winter Drift");
    expect(journeys[0]?.summary).toBe("A city-to-city winter line.");
    expect(journeys[0]?.tags).toEqual(["city", "winter"]);
    expect(journeys[0]?.stops[0]).toMatchObject({
      title: "Tokyo Arrival",
      summary: "First city morning.",
      tags: ["arrival"],
    });
  });

  it("sanitizes noisy geocode strings into human-readable stop labels", () => {
    const albums: Content[] = [
      buildAlbum({
        name: "snapshots",
        title: "",
        _build: {
          slug: "snapshots",
          srcdir: "../albums/snapshots",
        },
        blocks: [
          {
            kind: "photo",
            id: "a.jpg",
            data: { src: "a.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-01-01T08:00:00.000Z",
                GPSLatitude: [1, 17, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [103, 51, 0],
                GPSLongitudeRef: "E",
              },
              tags: {
                geocode: "SG Singapore 1.28967 103.85007 5638700 Singapore",
                colors: [[10, 20, 30]],
              },
              srcset: [{ src: "/a@800.avif", width: 1200, height: 800 }],
            },
          },
          {
            kind: "photo",
            id: "b.jpg",
            data: { src: "b.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-01-02T08:00:00.000Z",
                GPSLatitude: [1, 18, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [103, 52, 0],
                GPSLongitudeRef: "E",
              },
              tags: {
                geocode: "JP Annaka 36.33011 138.89585 57013 Gunma",
                colors: [[40, 50, 60]],
              },
              srcset: [{ src: "/b@800.avif", width: 1200, height: 800 }],
            },
          },
        ],
      }),
    ];

    const journeys = buildJourneys(albums);

    expect(journeys[0]?.startPlace).toBe("Singapore");
    expect(journeys[0]?.endPlace).toBe("Annaka Gunma");
    expect(journeys[0]?.stops[0]?.title).toBe("Singapore");
    expect(journeys[0]?.stops[1]?.title).toBe("Annaka Gunma");
  });

  it("detects trips across album boundaries and splits distant clusters", () => {
    const albums: Content[] = [
      buildAlbum({
        name: "trip-a",
        title: "Trip A",
        _build: {
          slug: "trip-a",
          srcdir: "../albums/trip-a",
        },
        blocks: [
          {
            kind: "photo",
            id: "a.jpg",
            data: { src: "a.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-01-01T08:00:00.000Z",
                GPSLatitude: [35, 40, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [139, 41, 0],
                GPSLongitudeRef: "E",
              },
              tags: {
                geocode: "Tokyo, Japan",
                colors: [[10, 20, 30]],
              },
              srcset: [{ src: "/a@800.avif", width: 1200, height: 800 }],
            },
          },
          {
            kind: "photo",
            id: "b.jpg",
            data: { src: "b.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-01-02T10:00:00.000Z",
                GPSLatitude: [35, 0, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [135, 46, 0],
                GPSLongitudeRef: "E",
              },
              tags: {
                geocode: "Kyoto, Japan",
                colors: [[30, 40, 50]],
              },
              srcset: [{ src: "/b@800.avif", width: 1200, height: 800 }],
            },
          },
        ],
      }),
      buildAlbum({
        name: "trip-b",
        title: "Trip B",
        _build: {
          slug: "trip-b",
          srcdir: "../albums/trip-b",
        },
        blocks: [
          {
            kind: "photo",
            id: "c.jpg",
            data: { src: "c.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-01-04T10:00:00.000Z",
                GPSLatitude: [34, 41, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [135, 30, 0],
                GPSLongitudeRef: "E",
              },
              tags: {
                geocode: "Osaka, Japan",
                colors: [[60, 70, 80]],
              },
              srcset: [{ src: "/c@800.avif", width: 1200, height: 800 }],
            },
          },
        ],
      }),
      buildAlbum({
        name: "trip-c",
        title: "Trip C",
        _build: {
          slug: "trip-c",
          srcdir: "../albums/trip-c",
        },
        blocks: [
          {
            kind: "photo",
            id: "d.jpg",
            data: { src: "d.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-03-01T09:00:00.000Z",
                GPSLatitude: [1, 17, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [103, 51, 0],
                GPSLongitudeRef: "E",
              },
              tags: {
                geocode: "Singapore",
                colors: [[90, 100, 110]],
              },
              srcset: [{ src: "/d@800.avif", width: 1200, height: 800 }],
            },
          },
          {
            kind: "photo",
            id: "e.jpg",
            data: { src: "e.jpg" },
            _build: {
              width: 1200,
              height: 800,
              exif: {
                DateTimeOriginal: "2024-03-02T09:00:00.000Z",
                GPSLatitude: [1, 18, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [103, 52, 0],
                GPSLongitudeRef: "E",
              },
              tags: {
                geocode: "Singapore",
                colors: [[120, 130, 140]],
              },
              srcset: [{ src: "/e@800.avif", width: 1200, height: 800 }],
            },
          },
        ],
      }),
    ];

    const journeys = buildJourneys(albums);

    expect(journeys).toHaveLength(2);
    expect(journeys[0]).toMatchObject({
      startPlace: "Singapore",
      endPlace: "Singapore",
      geotaggedPhotoCount: 2,
      stopCount: 2,
    });
    expect(journeys[1]).toMatchObject({
      startPlace: "Tokyo",
      endPlace: "Osaka",
      geotaggedPhotoCount: 3,
      stopCount: 3,
    });
    expect(journeys[1]?.stops.map((stop) => stop.title)).toEqual([
      "Tokyo",
      "Kyoto",
      "Osaka",
    ]);
  });
});

describe("loadJourneyEnrichmentOverrides", () => {
  it("returns null when the file does not exist", () => {
    expect(
      loadJourneyEnrichmentOverrides("/tmp/definitely-missing-journeys.json"),
    ).toBeNull();
  });
});
