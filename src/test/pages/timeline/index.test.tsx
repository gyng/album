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

  // A clip carries the same three things a photo does — a moment, a frame and a
  // place — once its poster has been extracted, so it belongs on the timeline
  // beside the photos taken at the same time rather than only on its album page.
  it("places videos on the timeline using their poster frame and recorded time", async () => {
    getAlbums.mockResolvedValue([
      {
        name: "kansai",
        title: "Kansai",
        blocks: [
          {
            kind: "video",
            id: "clip.mov",
            data: { type: "local", href: "/data/albums/kansai/.resized_videos/clip.mov@1920.mp4" },
            _build: {
              src: "/data/albums/kansai/.resized_videos/clip.mov@1920.mp4",
              originalSrc: "clip.mov",
              mimeType: "video/mp4",
              capturedAtLocal: "2024-01-02T03:04:05",
              latDeg: 35.6,
              lngDeg: 139.7,
              durationSeconds: 13.013,
              poster: {
                srcset: [{ src: "/clip.mov@800.avif", width: 300, height: 200 }],
              },
            },
          },
          {
            kind: "video",
            id: "unprepared.mov",
            data: {
              type: "local",
              href: "/data/albums/kansai/.resized_videos/unprepared.mov@1920.mp4",
            },
            _build: {
              src: "/data/albums/kansai/.resized_videos/unprepared.mov@1920.mp4",
              mimeType: "video/mp4",
              capturedAtLocal: "2024-01-02T03:04:05",
            },
          },
        ],
        formatting: {},
        _build: { slug: "kansai", srcdir: "../albums/kansai" },
      },
    ]);

    const entries = (await loadTimelinePageData()).entryRows.map(unpackTimelineEntry);

    // Only the clip with an extracted poster: without a frame there is nothing
    // to show in a day grid.
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      album: "kansai",
      date: "2024-01-02",
      dateTimeOriginal: "2024-01-02T03:04:05",
      decLat: 35.6,
      decLng: 139.7,
      href: "/album/kansai#clip.mov",
      path: "/data/albums/kansai/clip.mov",
      mediaKind: "video",
      src: { src: "/clip.mov@800.avif", width: 300, height: 200 },
    });
  });

  // An external is a video in the album with a date and, since the poster
  // prepass downloads its thumbnail, a frame — so it belongs beside the photos
  // shot the same day rather than only inside its album page.
  it("places a YouTube external on the timeline through its downloaded thumbnail", async () => {
    getAlbums.mockResolvedValue([
      {
        name: "kansai",
        title: "Kansai",
        blocks: [
          {
            kind: "video",
            id: "ycyUWULJxdU.youtube",
            data: {
              type: "youtube",
              href: "https://www.youtube.com/embed/ycyUWULJxdU",
              date: "2025-12-01T22:00:00+09:00",
            },
            _build: {
              src: "https://www.youtube.com/embed/ycyUWULJxdU",
              mimeType: "video/youtube",
              capturedAtLocal: "2025-12-01T22:00:00",
              poster: {
                srcset: [{ src: "/ycyUWULJxdU.youtube@800.avif", width: 800, height: 450 }],
              },
            },
          },
        ],
        formatting: {},
        _build: { slug: "kansai", srcdir: "../albums/kansai" },
      },
    ]);

    const entries = (await loadTimelinePageData()).entryRows.map(unpackTimelineEntry);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      mediaKind: "video",
      dateTimeOriginal: "2025-12-01T22:00:00",
      href: "/album/kansai#ycyUWULJxdU.youtube",
      src: { src: "/ycyUWULJxdU.youtube@800.avif", width: 800, height: 450 },
    });
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
