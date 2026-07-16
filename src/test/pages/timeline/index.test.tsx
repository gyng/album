/**
 * @jest-environment node
 */

export {};

const { unpackTimelineEntry } =
  require("../../../util/pageDataRows") as typeof import("../../../util/pageDataRows");

const getAlbums = jest.fn();

jest.mock("../../../services/album", () => ({
  getAlbums,
}));

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../../components/CalendarHeatmap", () => ({
  CalendarHeatmap: () => null,
}));

jest.mock("../../../components/TimelineDayGrid", () => ({
  TimelineDayGrid: () => null,
}));

const { loadTimelinePageData } = require("../../../services/pageData/timeline");

describe("timeline page data fetching", () => {
  beforeEach(() => {
    getAlbums.mockReset();
  });

  it("builds dated timeline entries from photo blocks and skips undated photos", async () => {
    getAlbums.mockResolvedValue([
      {
        name: "kansai",
        title: "Kansai",
        blocks: [
          {
            kind: "photo",
            id: "a.jpg",
            data: { src: "a.jpg" },
            _build: {
              width: 300,
              height: 200,
              exif: {
                DateTimeOriginal: "2024-01-02T03:04:05",
                GPSLatitude: [35, 36, 0],
                GPSLatitudeRef: "N",
                GPSLongitude: [139, 42, 0],
                GPSLongitudeRef: "E",
              },
              tags: { colors: [[1, 2, 3]] },
              srcset: [{ src: "/a@800.avif", width: 300, height: 200 }],
            },
          },
          {
            kind: "photo",
            id: "missing.jpg",
            data: { src: "missing.jpg" },
            _build: {
              width: 300,
              height: 200,
              exif: {},
              tags: { colors: [[9, 9, 9]] },
              srcset: [{ src: "/missing@800.avif", width: 300, height: 200 }],
            },
          },
        ],
        formatting: {},
        _build: { slug: "kansai", srcdir: "../albums/kansai" },
      },
      {
        name: "tokyo",
        title: "Tokyo",
        blocks: [
          {
            kind: "photo",
            id: "b.jpg",
            data: { src: "b.jpg" },
            _build: {
              width: 640,
              height: 480,
              exif: { DateTimeOriginal: "2024-03-05T11:22:33" },
              tags: { colors: [[4, 5, 6]] },
              srcset: [{ src: "/b@800.avif", width: 640, height: 480 }],
            },
          },
        ],
        formatting: {},
        _build: { slug: "tokyo", srcdir: "../albums/tokyo" },
      },
    ]);

    const actual = await loadTimelinePageData();

    expect(actual.entryRows.every((row: unknown) => Array.isArray(row))).toBe(true);
    expect(actual.entryRows.map(unpackTimelineEntry)).toEqual([
      {
        album: "tokyo",
        date: "2024-03-05",
        dateTimeOriginal: "2024-03-05T11:22:33",
        decLat: null,
        decLng: null,
        href: "/album/tokyo#b.jpg",
        path: "b.jpg",
        geocode: null,
        placeholderColor: "rgba(4, 5, 6, 1)",
        placeholderHeight: 480,
        placeholderWidth: 640,
        src: { src: "/b@800.avif", width: 640, height: 480 },
      },
      {
        album: "kansai",
        date: "2024-01-02",
        dateTimeOriginal: "2024-01-02T03:04:05",
        decLat: 35.6,
        decLng: 139.7,
        href: "/album/kansai#a.jpg",
        path: "a.jpg",
        geocode: null,
        placeholderColor: "rgba(1, 2, 3, 1)",
        placeholderHeight: 200,
        placeholderWidth: 300,
        src: { src: "/a@800.avif", width: 300, height: 200 },
      },
    ]);
  });

  it("skips unusable dated photos and deterministically sorts equal dates", async () => {
    const makePhoto = (
      id: string,
      date: string,
      exif: Record<string, unknown> = {},
      withSrc = true,
    ) => ({
      kind: "photo",
      id,
      data: { src: `nested/${id}` },
      _build: {
        width: 10,
        height: 20,
        exif: { DateTimeOriginal: date, ...exif },
        tags: id === "b.jpg" ? { geocode: "Somewhere" } : {},
        srcset: withSrc ? [{ src: `/${id}`, width: 10, height: 20 }] : [],
      },
    });
    getAlbums.mockResolvedValue([
      {
        blocks: [
          makePhoto("missing-src.jpg", "2024-01-01T00:00:00", {}, false),
          makePhoto("invalid.jpg", "not-a-date"),
          makePhoto("gps-one.jpg", "2024-01-01T09:00:00", { GPSLongitude: [1] }),
          makePhoto("gps-two.jpg", "2024-01-01T09:00:00", {
            GPSLongitude: [1],
            GPSLatitude: [2],
          }),
          makePhoto("gps-three.jpg", "2024-01-01T09:00:00", {
            GPSLongitude: [1],
            GPSLatitude: [2],
            GPSLongitudeRef: "E",
          }),
          makePhoto("b.jpg", "2024-01-01T11:00:00"),
          makePhoto("a.jpg", "2024-01-01T11:00:00"),
        ],
        _build: { slug: "equal" },
      },
    ]);

    const result = await loadTimelinePageData();
    const entries = result.entryRows.map(unpackTimelineEntry);
    expect(entries.map((entry: { path: string }) => entry.path)).toEqual([
      "nested/a.jpg",
      "nested/b.jpg",
      "nested/gps-one.jpg",
      "nested/gps-three.jpg",
      "nested/gps-two.jpg",
    ]);
    expect(entries[0]).toMatchObject({
      placeholderColor: "transparent",
      geocode: null,
    });
    expect(entries[1]).toMatchObject({ geocode: "Somewhere" });
  });
});
