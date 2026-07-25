import type { MapWorldEntry, TimeRange } from "../util/pageDataTypes";
import {
  filterPhotosByBounds,
  filterPhotosByQuery,
  formatMapPhotoDate,
  formatMapPhotoDateTime,
  getLegendYears,
  getPhotoDateStats,
  isPhotoInTimeRange,
  nextThumbnailStage,
  stylePhotosByRecency,
  thinPhotosByScreenCell,
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
    expect(formatMapPhotoDate("not-a-date")).toBeNull();
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

    expect(
      stylePhotosByRecency([photo()], {
        oldest: photo(),
        newest: photo(),
        oldestMs: Number.NaN,
        range: 1,
      })[0]?.relative,
    ).toBe(0);
  });

  it("waits for bounds before exposing markers and handles an ordinary viewport", () => {
    const photos = stylePhotosByRecency(
      [
        photo({ href: "inside", decLat: 35, decLng: 139 }),
        photo({ href: "north", decLat: 55, decLng: 139 }),
        photo({ href: "east", decLat: 35, decLng: 155 }),
        photo({ href: "no-latitude", decLat: null }),
        photo({ href: "no-longitude", decLng: null }),
      ],
      getPhotoDateStats([]),
    );

    expect(filterPhotosByBounds(photos, null)).toEqual([]);
    expect(
      filterPhotosByBounds(photos, { north: 50, south: 20, west: 120, east: 150 }).map(
        ({ href }) => href,
      ),
    ).toEqual(["inside"]);
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
    expect(getLegendYears(getPhotoDateStats([]))).toEqual({ older: "Older", newer: "Newer" });
    expect(
      getLegendYears({ oldest: photo({ date: null }), newest: photo({ date: "not-a-date" }) }),
    ).toEqual({ older: "Older", newer: "Newer" });
  });

  it("filters map photos client-side with accent-insensitive all-term matching", () => {
    const photos = [
      photo({ href: "hong-kong" }),
      photo({ href: "japan" }),
      photo({ href: "france" }),
    ];
    const searchIndex = new Map([
      ["hong-kong", "Hong Kong cute café cat"],
      ["japan", "Kyoto temple cat"],
      ["france", "Paris café"],
    ]);

    expect(
      filterPhotosByQuery(photos, "  CAFE hong ", searchIndex).map(({ href }) => href),
    ).toEqual(["hong-kong"]);
    expect(filterPhotosByQuery(photos, "cat", searchIndex).map(({ href }) => href)).toEqual([
      "hong-kong",
      "japan",
    ]);
    expect(filterPhotosByQuery(photos, "")).toBe(photos);
    expect(
      filterPhotosByQuery(
        [photo({ href: "external" })],
        "fuzzy",
        new Map([["external", "cute fuzzy animal"]]),
      ).map(({ href }) => href),
    ).toEqual(["external"]);
    expect(
      filterPhotosByQuery([photo({ album: "Undated archive", date: null })], "undated archive"),
    ).toHaveLength(1);
  });
});

describe("nextThumbnailStage", () => {
  it("reveals above the reveal zoom and warms in the band below it", () => {
    expect(nextThumbnailStage(8.6, "hidden")).toBe("shown");
    expect(nextThumbnailStage(8.3, "hidden")).toBe("warming");
    expect(nextThumbnailStage(7.9, "hidden")).toBe("hidden");
  });

  it("holds the thumbnails through a wobble around the reveal zoom", () => {
    // Revealed at 8.6, a zoom that drifts back to 8.3 keeps them: without the
    // hysteresis band a pinch resting on the threshold swaps the whole marker
    // path back and forth every frame.
    expect(nextThumbnailStage(8.3, "shown")).toBe("shown");
    expect(nextThumbnailStage(8.1, "shown")).toBe("warming");
    expect(nextThumbnailStage(7.5, "shown")).toBe("hidden");
  });

  it("warms again on the way back up before revealing", () => {
    expect(nextThumbnailStage(8.2, "warming")).toBe("warming");
    expect(nextThumbnailStage(8.51, "warming")).toBe("shown");
    expect(nextThumbnailStage(8, "warming")).toBe("hidden");
  });
});

describe("thinPhotosByScreenCell", () => {
  const viewport = { bounds: { north: 10, south: 0, east: 10, west: 0 }, width: 100, height: 100 };

  it("keeps one photo per cell and leaves the rest to the drawn layer", () => {
    // A 10x10 degree viewport shown in 100x100px: a 50px cell is 5 degrees.
    const photos = [
      photo({ href: "a", decLat: 1, decLng: 1 }),
      photo({ href: "b", decLat: 2, decLng: 2 }), // same cell as "a"
      photo({ href: "c", decLat: 8, decLng: 8 }), // a cell of its own
    ];

    const { thumbnails, pins } = thinPhotosByScreenCell(photos, { ...viewport, cellPx: 50 });
    expect(thumbnails.map(({ href }) => href)).toEqual(["a", "c"]);
    expect(pins.map(({ href }) => href)).toEqual(["b"]);
  });

  it("is stable under a pan, so thumbnails do not reshuffle as the map moves", () => {
    const photos = [
      photo({ href: "a", decLat: 1, decLng: 1 }),
      photo({ href: "b", decLat: 2, decLng: 2 }),
    ];
    // The same photos seen from a viewport shifted by less than a cell: the
    // grid is anchored to the world, not to the screen, so the same photo wins.
    const shifted = { bounds: { north: 11, south: 1, east: 11, west: 1 }, width: 100, height: 100 };

    expect(
      thinPhotosByScreenCell(photos, { ...viewport, cellPx: 50 }).thumbnails.map((p) => p.href),
    ).toEqual(["a"]);
    expect(
      thinPhotosByScreenCell(photos, { ...shifted, cellPx: 50 }).thumbnails.map((p) => p.href),
    ).toEqual(["a"]);
  });

  it("thins nothing when a cell holds at most one photo, or when there is no viewport to measure", () => {
    const photos = [
      photo({ href: "a", decLat: 1, decLng: 1 }),
      photo({ href: "b", decLat: 9, decLng: 9 }),
    ];
    expect(thinPhotosByScreenCell(photos, { ...viewport, cellPx: 10 }).pins).toEqual([]);
    // A zero-sized container cannot say how far apart two photos look, so
    // everything keeps its thumbnail rather than being silently dropped.
    const unmeasurable = thinPhotosByScreenCell(photos, { ...viewport, width: 0, cellPx: 50 });
    expect(unmeasurable.thumbnails).toHaveLength(2);
    expect(unmeasurable.pins).toEqual([]);
  });
});

describe("thinPhotosByScreenCell incumbency", () => {
  const viewport = { bounds: { north: 10, south: 0, east: 10, west: 0 }, width: 100, height: 100 };

  it("lets a photo that already has a thumbnail keep its cell", () => {
    // Panning brings new photos into range, and without this the newcomer could
    // take the cell from the thumbnail already on the map — swapping a picture
    // the reader was looking at for a different one, at the same spot.
    const incumbent = photo({ href: "incumbent", decLat: 2, decLng: 2 });
    const newcomer = photo({ href: "newcomer", decLat: 1, decLng: 1 });

    const cold = thinPhotosByScreenCell([newcomer, incumbent], { ...viewport, cellPx: 50 });
    expect(cold.thumbnails.map(({ href }) => href)).toEqual(["newcomer"]);

    const warm = thinPhotosByScreenCell(
      [newcomer, incumbent],
      { ...viewport, cellPx: 50 },
      new Set(["incumbent"]),
    );
    expect(warm.thumbnails.map(({ href }) => href)).toEqual(["incumbent"]);
    expect(warm.pins.map(({ href }) => href)).toEqual(["newcomer"]);
  });

  it("gives the cell up once the incumbent is out of range", () => {
    const arrival = photo({ href: "arrival", decLat: 1, decLng: 1 });
    const { thumbnails } = thinPhotosByScreenCell(
      [arrival],
      { ...viewport, cellPx: 50 },
      new Set(["long-gone"]),
    );
    expect(thumbnails.map(({ href }) => href)).toEqual(["arrival"]);
  });
});
