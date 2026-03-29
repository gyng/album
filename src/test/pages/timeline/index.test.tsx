/**
 * @jest-environment node
 */

export {};

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

const { getStaticProps: getTimelinePageStaticProps } = require("../../../pages/timeline/index");

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
                DateTimeOriginal: "2024-01-02T03:04:05.000Z",
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
              exif: { DateTimeOriginal: "2024-03-05T11:22:33.000Z" },
              tags: { colors: [[4, 5, 6]] },
              srcset: [{ src: "/b@800.avif", width: 640, height: 480 }],
            },
          },
        ],
        formatting: {},
        _build: { slug: "tokyo", srcdir: "../albums/tokyo" },
      },
    ]);

    const actual = await getTimelinePageStaticProps({});

    expect(actual).toEqual({
      props: {
        entries: [
          {
            album: "tokyo",
            date: "2024-03-05",
            dateTimeOriginal: "2024-03-05T11:22:33.000Z",
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
            dateTimeOriginal: "2024-01-02T03:04:05.000Z",
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
        ],
      },
    });
  });
});
