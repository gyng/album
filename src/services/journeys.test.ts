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
      id: "japan",
      albumSlug: "japan",
      title: "Japan Winter Loop",
      stopCount: 2,
      geotaggedPhotoCount: 3,
      startPlace: "Tokyo",
      endPlace: "Osaka",
    });
    expect(journeys[0]?.summary).toContain("2 stops");
    expect(journeys[0]?.distanceKm).toBeGreaterThan(300);
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
        trip: {
          title: "Urban Winter Drift",
          summary: "A city-to-city winter line.",
          tags: ["city", "winter"],
        },
      },
      stops: {
        "trip:0": {
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
});

describe("loadJourneyEnrichmentOverrides", () => {
  it("returns null when the file does not exist", () => {
    expect(
      loadJourneyEnrichmentOverrides("/tmp/definitely-missing-journeys.json"),
    ).toBeNull();
  });
});
