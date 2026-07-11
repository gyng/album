import type { MapWorldEntry, TimeRange } from "./MapWorld";
import {
  filterPhotosByBounds,
  formatMapPhotoDate,
  formatMapPhotoDateTime,
  getLegendYears,
  getPhotoDateStats,
  isPhotoInTimeRange,
  stylePhotosByRecency,
} from "./mapWorldViewModel";

const photo = (overrides: Partial<MapWorldEntry> = {}): MapWorldEntry => ({
  album: "test-album",
  src: { src: "/photo.jpg", width: 100, height: 100 },
  decLat: 35,
  decLng: 139,
  date: "2024-01-02T03:04:05",
  href: "/album/test-album#photo.jpg",
  ...overrides,
});

describe("mapWorldViewModel", () => {
  it("formats camera-local timestamps without timezone conversion", () => {
    expect(formatMapPhotoDate("2024-01-02T03:04:05")).toBe("2 Jan 2024");
    expect(formatMapPhotoDateTime("2024-01-02T03:04:05")).toBe("2 Jan 2024, 03:04");
    expect(formatMapPhotoDateTime("not-a-date")).toBeNull();
  });

  it("filters dated photos against an inclusive wall-clock range", () => {
    const range: TimeRange = {
      fromMs: Date.UTC(2024, 0, 2, 3, 4, 5),
      toMs: Date.UTC(2024, 0, 3, 3, 4, 5),
    };

    expect(isPhotoInTimeRange(photo(), range)).toBe(true);
    expect(isPhotoInTimeRange(photo({ date: "2024-01-03T03:04:05" }), range)).toBe(true);
    expect(isPhotoInTimeRange(photo({ date: "2024-01-04T03:04:05" }), range)).toBe(false);
    expect(isPhotoInTimeRange(photo({ date: null }), range)).toBe(false);
  });

  it("derives recency styles without mutating the input", () => {
    const photos = [
      photo({ href: "newest", date: "2024-12-31T23:00:00" }),
      photo({ href: "undated", date: null }),
      photo({ href: "oldest", date: "2020-01-01T01:00:00" }),
    ];

    const stats = getPhotoDateStats(photos);
    const styled = stylePhotosByRecency(photos, stats);

    expect(photos.map(({ href }) => href)).toEqual(["newest", "undated", "oldest"]);
    expect(styled.map(({ href }) => href)).toEqual(["undated", "oldest", "newest"]);
    expect(styled.map(({ relative }) => relative)).toEqual([0, 0, 1]);
    expect(styled.every(({ markerColor }) => !markerColor.includes("NaN"))).toBe(true);
  });

  it("keeps photos inside an antimeridian-crossing viewport", () => {
    const photos = stylePhotosByRecency(
      [
        photo({ href: "east", decLng: 175 }),
        photo({ href: "west", decLng: -175 }),
        photo({ href: "outside", decLng: 0 }),
        photo({ href: "missing", decLng: null }),
      ],
      getPhotoDateStats([]),
    );

    expect(
      filterPhotosByBounds(photos, { north: 50, south: 20, west: 170, east: -170 }).map(
        ({ href }) => href,
      ),
    ).toEqual(["east", "west"]);
  });

  it("uses year labels only when the collection spans distinct valid years", () => {
    expect(
      getLegendYears(
        getPhotoDateStats([
          photo({ date: "2020-01-01T00:00:00" }),
          photo({ date: "2024-01-01T00:00:00" }),
        ]),
      ),
    ).toEqual({ older: "2020", newer: "2024" });

    expect(getLegendYears(getPhotoDateStats([photo(), photo({ date: null })]))).toEqual({
      older: "Older",
      newer: "Newer",
    });
  });
});
