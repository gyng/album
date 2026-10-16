import { computePhotoStats } from "./computeStats";
import { Block, Content, PhotoBlock, VideoBlock } from "../services/types";
import { weatherFixture } from "../test/fixtures/weather";

const makePhoto = (overrides: Partial<PhotoBlock["_build"]> = {}): PhotoBlock => ({
  kind: "photo",
  id: "test.jpg",
  data: { src: "/test.jpg" },
  formatting: {},
  _build: {
    width: 100,
    height: 100,
    exif: {},
    tags: null as any,
    srcset: [],
    ...overrides,
  },
});

const makeAlbum = (blocks: Block[], name = "test-album"): Content => ({
  name,
  title: name,
  blocks,
  formatting: {},
  _build: { slug: name, srcdir: `../albums/${name}` },
});

type VideoBuild = NonNullable<VideoBlock["_build"]>;

const makeVideo = (overrides: Partial<VideoBuild> = {}): VideoBlock => ({
  kind: "video",
  id: "clip.mov",
  data: { type: "local", href: "/clip.mov" },
  _build: {
    src: "/data/albums/test-album/.resized_videos/clip.mov@1920.mp4",
    mimeType: "video/mp4",
    poster: { srcset: [{ src: "/clip.mov@800.avif", width: 800, height: 450 }] },
    ...overrides,
  },
});

describe("computePhotoStats", () => {
  it("selects bounded weather examples across each bucket without including missing estimates", () => {
    const photos = Array.from({ length: 10 }, (_, index) => ({
      ...makePhoto({ tags: { weather: weatherFixture } }),
      id: `weather ${index}.jpg`,
      data: { src: `/weather ${index}.jpg` },
    }));
    const stats = computePhotoStats([makeAlbum([...photos, makePhoto()])]);
    const examples = stats.stringFacets.find((facet) => facet.facetId === "weather-condition")
      ?.examples?.Overcast;
    expect(examples).toHaveLength(4);
    expect(examples?.map((photo) => photo.src)).toEqual([
      "/weather%200.jpg",
      "/weather%203.jpg",
      "/weather%206.jpg",
      "/weather%209.jpg",
    ]);
    expect(examples?.[0]?.href).toBe("/album/test-album#weather%200.jpg");
    expect(
      stats.stringFacets.find((facet) => facet.facetId === "weather-temperature")?.examples,
    ).toHaveProperty("20–29°C");
  });
  it("counts weather estimates and reports coverage without treating missing weather as dry", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({ tags: { weather: weatherFixture } }),
        makePhoto({
          tags: {
            weather: { ...weatherFixture, temperature_2m: -2, weather_code: 73, precipitation: 2 },
          },
        }),
        makePhoto(),
      ]),
    ]);
    expect(stats.stringFacets.find((facet) => facet.facetId === "weather-condition")).toMatchObject(
      {
        coverage: 2 / 3,
        data: expect.arrayContaining([
          { label: "Overcast", count: 1 },
          { label: "Snow", count: 1 },
        ]),
      },
    );
    expect(
      stats.stringFacets.find((facet) => facet.facetId === "weather-precipitation")?.data,
    ).toEqual([
      { label: "Dry", count: 1 },
      { label: "Precipitation", count: 1 },
    ]);
    expect(
      stats.stringFacets.find((facet) => facet.facetId === "weather-temperature")?.data,
    ).toEqual([
      { label: "Below 0°C", count: 1 },
      { label: "20–29°C", count: 1 },
    ]);
  });
  it("counts published aspect ratios and orientations, respecting rotation and missing dimensions", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({ width: 6000, height: 4000 }),
        makePhoto({ width: 3000, height: 2000 }),
        makePhoto({ width: 6000, height: 4000, exif: { Orientation: "Rotate 90 CW" } }),
        makePhoto({ width: 1200, height: 1200 }),
        makePhoto({ width: 4432, height: 2955 }),
        makePhoto({ width: 0, height: 0 }),
      ]),
    ]);
    expect(stats.stringFacets.find((facet) => facet.facetId === "aspect-ratio")).toMatchObject({
      coverage: 5 / 6,
      data: [
        { label: "3:2", count: 3 },
        { label: "1:1", count: 1 },
        { label: "2:3", count: 1 },
      ],
    });
    expect(stats.stringFacets.find((facet) => facet.facetId === "orientation")).toMatchObject({
      coverage: 5 / 6,
      data: [
        { label: "Landscape", count: 3 },
        { label: "Portrait", count: 1 },
        { label: "Square", count: 1 },
      ],
    });
  });

  it("returns zeros for empty albums", () => {
    const stats = computePhotoStats([]);
    expect(stats.totalPhotos).toBe(0);
    expect(stats.totalAlbums).toBe(0);
    expect(stats.dateRange).toBeNull();
  });

  it("counts photos and albums correctly", () => {
    const stats = computePhotoStats([
      makeAlbum([makePhoto(), makePhoto()], "album-a"),
      makeAlbum([makePhoto()], "album-b"),
    ]);
    expect(stats.totalPhotos).toBe(3);
    expect(stats.totalAlbums).toBe(2);
  });

  it("computes dateRange from DateTimeOriginal", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({ exif: { DateTimeOriginal: "2022:06:01 10:00:00" } }),
        makePhoto({ exif: { DateTimeOriginal: "2024:03:22 18:30:00" } }),
        makePhoto({ exif: {} }), // no date
      ]),
    ]);
    expect(stats.dateRange).toEqual([2022, 2024]);
  });

  it("dateRange is null when no photos have dates", () => {
    const stats = computePhotoStats([makeAlbum([makePhoto()])]);
    expect(stats.dateRange).toBeNull();
  });

  it("computes focal length 35mm coverage correctly", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({ exif: { FocalLengthIn35mmFormat: 35 } }),
        makePhoto({ exif: { FocalLengthIn35mmFormat: 85 } }),
        makePhoto({ exif: {} }), // missing
      ]),
    ]);

    const fl = stats.numericFacets.find((f) => f.facetId === "focal-length-35mm")!;
    expect(fl.coverage).toBeCloseTo(2 / 3);
    expect(fl.data.find((b) => b.label === "35–49mm · normal")?.count).toBe(1);
    expect(fl.data.find((b) => b.label === "85–134mm · tele")?.count).toBe(1);
    expect(fl.data.find((b) => b.label === "<24mm · ultra-wide")?.count).toBe(0);
  });

  it("focal length 35mm does NOT count photos with only FocalLength", () => {
    const stats = computePhotoStats([makeAlbum([makePhoto({ exif: { FocalLength: 23 } })])]);
    const fl = stats.numericFacets.find((f) => f.facetId === "focal-length-35mm")!;
    expect(fl.coverage).toBe(0);
  });

  it("ignores non-finite numeric EXIF values instead of reporting false coverage", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          exif: {
            FocalLengthIn35mmFormat: Number.NaN,
            FocalLength: Number.POSITIVE_INFINITY,
            FNumber: Number.NaN,
            ISO: Number.NEGATIVE_INFINITY,
          },
        }),
      ]),
    ]);

    for (const facetId of ["focal-length-35mm", "focal-length-actual", "aperture", "iso"]) {
      expect(stats.numericFacets.find((facet) => facet.facetId === facetId)?.coverage).toBe(0);
    }
    expect(stats.technicalRelationships).toBeNull();
  });

  it("reports numeric field coverage when a finite value falls between display buckets", () => {
    const stats = computePhotoStats([makeAlbum([makePhoto({ exif: { FocalLength: 22.5 } })])]);

    const facet = stats.numericFacets.find((item) => item.facetId === "focal-length-actual")!;
    expect(facet.coverage).toBe(1);
    expect(facet.data.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it("focal length actual does NOT count photos with only FocalLengthIn35mmFormat", () => {
    const stats = computePhotoStats([
      makeAlbum([makePhoto({ exif: { FocalLengthIn35mmFormat: 35 } })]),
    ]);
    const fl = stats.numericFacets.find((f) => f.facetId === "focal-length-actual")!;
    expect(fl.coverage).toBe(0);
  });

  it("computes camera counts correctly", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({ exif: { Make: "FUJIFILM", Model: "X-T5" } }),
        makePhoto({ exif: { Make: "FUJIFILM", Model: "X-T5" } }),
        makePhoto({ exif: { Make: "SONY", Model: "A7IV" } }),
        makePhoto({ exif: {} }),
      ]),
    ]);

    const cam = stats.stringFacets.find((f) => f.facetId === "camera")!;
    expect(cam.coverage).toBeCloseTo(3 / 4);
    expect(cam.data[0]).toEqual({ label: "FUJIFILM X-T5", count: 2 });
    expect(cam.data[1]).toEqual({ label: "SONY A7IV", count: 1 });
  });

  it("computes camera-to-lens flow data", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          exif: {
            Make: "FUJIFILM",
            Model: "X-T5",
            LensModel: "XF35mmF1.4 R",
          },
        }),
        makePhoto({
          exif: {
            Make: "FUJIFILM",
            Model: "X-T5",
            LensModel: "XF35mmF1.4 R",
          },
        }),
        makePhoto({
          exif: {
            Make: "FUJIFILM",
            Model: "X-T5",
            LensModel: "XF23mmF2 R WR",
          },
        }),
        makePhoto({
          exif: {
            Make: "SONY",
            Model: "A7IV",
            LensModel: "FE 55mm F1.8 ZA",
          },
        }),
        makePhoto({
          exif: {
            Make: "SONY",
            Model: "A7IV",
          },
        }),
      ]),
    ]);

    expect(stats.gearFlow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "camera:FUJIFILM X-T5",
          label: "FUJIFILM X-T5",
          count: 3,
          depth: 0,
          facetId: "camera",
          facetValue: "FUJIFILM X-T5",
        }),
        expect.objectContaining({
          id: "lens:XF35mmF1.4 R",
          label: "XF35mmF1.4 R",
          count: 2,
          depth: 1,
          facetId: "lens",
          facetValue: "XF35mmF1.4 R",
        }),
        expect.objectContaining({
          id: "lens:Unknown / built-in lens",
          label: "Unknown / built-in lens",
          count: 1,
          depth: 1,
          facetId: "lens",
          facetValue: "Unknown / built-in lens",
        }),
      ]),
    );

    expect(stats.gearFlow.links).toEqual(
      expect.arrayContaining([
        {
          source: "camera:FUJIFILM X-T5",
          target: "lens:XF35mmF1.4 R",
          count: 2,
        },
        {
          source: "camera:FUJIFILM X-T5",
          target: "lens:XF23mmF2 R WR",
          count: 1,
        },
        {
          source: "camera:SONY A7IV",
          target: "lens:FE 55mm F1.8 ZA",
          count: 1,
        },
        {
          source: "camera:SONY A7IV",
          target: "lens:Unknown / built-in lens",
          count: 1,
        },
      ]),
    );
  });

  it("orders equally frequent cameras alphabetically", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({ exif: { Make: "ZEISS", Model: "ZX1" } }),
        makePhoto({ exif: { Make: "CANON", Model: "R5" } }),
      ]),
    ]);

    expect(
      stats.gearFlow.nodes.filter((node) => node.depth === 0).map((node) => node.label),
    ).toEqual(["CANON R5", "ZEISS ZX1"]);
  });

  it("computes prime vs zoom lens-type stats", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          exif: {
            LensModel: "XF35mmF1.4 R",
          },
        }),
        makePhoto({
          exif: {
            LensModel: "XF23mmF2 R WR",
          },
        }),
        makePhoto({
          exif: {
            LensModel: "RF 24-70mm F2.8 L IS USM",
          },
        }),
        makePhoto({
          exif: {
            LensModel: "Some strange lens name",
          },
        }),
        makePhoto({
          exif: {},
        }),
      ]),
    ]);

    expect(stats.lensTypeStats).toEqual({
      prime: 2,
      zoom: 1,
      unknown: 2,
    });
  });

  it("precomputes technical relationship filters for camera and lens", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          exif: {
            DateTimeOriginal: "2024:03:22 17:45:00",
            OffsetTime: "+09:00",
            FocalLengthIn35mmFormat: 35,
            FNumber: 2,
            ISO: 400,
            Make: "FUJIFILM",
            Model: "X-T5",
            LensModel: "XF35mmF1.4 R",
          },
        }),
        makePhoto({
          exif: {
            DateTimeOriginal: "2024:03:22 18:45:00",
            OffsetTime: "+09:00",
            FocalLengthIn35mmFormat: 35,
            FNumber: 2,
            ISO: 800,
            Make: "FUJIFILM",
            Model: "X-T5",
            LensModel: "XF35mmF1.4 R",
          },
        }),
        makePhoto({
          exif: {
            DateTimeOriginal: "2024:03:23 09:00:00",
            OffsetTime: "+09:00",
            FocalLengthIn35mmFormat: 85,
            FNumber: 4,
            ISO: 400,
            Make: "SONY",
            Model: "A7IV",
            LensModel: "FE 85mm F1.8",
          },
        }),
      ]),
    ]);

    expect(stats.technicalRelationshipFilters.cameras).toEqual(["FUJIFILM X-T5", "SONY A7IV"]);
    expect(stats.technicalRelationshipFilters.lensesByCamera["FUJIFILM X-T5"]).toEqual([
      "XF35mmF1.4 R",
    ]);
    expect(
      stats.technicalRelationshipFilters.byCamera["FUJIFILM X-T5"]?.technicalRelationships?.total,
    ).toBe(2);
    expect(
      stats.technicalRelationshipFilters.byLens["FE 85mm F1.8"]?.technicalRelationships?.total,
    ).toBe(1);
    expect(
      stats.technicalRelationshipFilters.byCamera["FUJIFILM X-T5"]?.timeRelationships?.total,
    ).toBe(2);
    expect(
      stats.technicalRelationshipFilters.byCamera["FUJIFILM X-T5"]?.weekdayStats.find(
        (bucket) => bucket.label === "Fri",
      )?.count,
    ).toBe(2);
    expect(
      stats.technicalRelationshipFilters.byCameraLens["FUJIFILM X-T5"]?.["XF35mmF1.4 R"]
        ?.technicalRelationships?.total,
    ).toBe(2);
  });

  it("computes hour-of-day coverage (only counts photos with OffsetTime)", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({ exif: { DateTimeOriginal: "2024:03:22 17:45:00", OffsetTime: "+09:00" } }),
        makePhoto({ exif: { DateTimeOriginal: "2024:03:22 17:30:00", OffsetTime: "+09:00" } }),
        makePhoto({ exif: { DateTimeOriginal: "2024:03:22 09:00:00", OffsetTime: "+09:00" } }),
        makePhoto({ exif: {} }), // no offset — excluded
      ]),
    ]);

    const hour = stats.numericFacets.find((f) => f.facetId === "hour")!;
    expect(hour.coverage).toBeCloseTo(3 / 4);
    expect(hour.data.find((b) => b.label === "17:00")?.count).toBe(2);
    expect(hour.data.find((b) => b.label === "09:00")?.count).toBe(1);
    expect(hour.data.find((b) => b.label === "00:00")?.count).toBe(0);
  });

  it("computes weekday and month cadence from local EXIF dates", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({ exif: { DateTimeOriginal: "2024:03:22 17:45:00" } }), // Fri Mar
        makePhoto({ exif: { DateTimeOriginal: "2024:03:23 09:00:00" } }), // Sat Mar
        makePhoto({ exif: { DateTimeOriginal: "2024:12:25 08:00:00" } }), // Wed Dec
        makePhoto({ exif: {} }),
      ]),
    ]);

    expect(stats.calendarCoverage).toBeCloseTo(3 / 4);
    expect(stats.weekdayStats.find((bucket) => bucket.label === "Fri")?.count).toBe(1);
    expect(stats.weekdayStats.find((bucket) => bucket.label === "Sat")?.count).toBe(1);
    expect(stats.weekdayStats.find((bucket) => bucket.label === "Wed")?.count).toBe(1);
    expect(stats.monthStats.find((bucket) => bucket.label === "Mar")?.count).toBe(2);
    expect(stats.monthStats.find((bucket) => bucket.label === "Dec")?.count).toBe(1);
  });

  it("computes recent month and year trend stats from the latest dated photo", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({ exif: { DateTimeOriginal: "2010:01:01 10:00:00" } }),
        makePhoto({ exif: { DateTimeOriginal: "2023:12:31 10:00:00" } }),
        makePhoto({ exif: { DateTimeOriginal: "2024:03:22 17:45:00" } }),
        makePhoto({ exif: { DateTimeOriginal: "2024:03:23 09:00:00" } }),
        makePhoto({ exif: { DateTimeOriginal: "2024:12:25 08:00:00" } }),
        makePhoto({ exif: {} }),
      ]),
    ]);

    expect(stats.recentMonthStats).toHaveLength(12);
    expect(stats.recentMonthStats.at(-1)).toEqual({ label: "Dec '24", count: 1 });
    expect(stats.recentMonthStats.find((bucket) => bucket.label === "Mar '24")?.count).toBe(2);
    expect(stats.recentYearStats).toEqual([
      {
        label: "2020",
        data: expect.arrayContaining([{ label: "Jan", count: 0 }]),
      },
      {
        label: "2021",
        data: expect.arrayContaining([{ label: "Jan", count: 0 }]),
      },
      {
        label: "2022",
        data: expect.arrayContaining([{ label: "Jan", count: 0 }]),
      },
      {
        label: "2023",
        data: expect.arrayContaining([
          { label: "Dec", count: 1 },
          { label: "Mar", count: 0 },
        ]),
      },
      {
        label: "2024",
        data: expect.arrayContaining([
          { label: "Mar", count: 2 },
          { label: "Dec", count: 1 },
        ]),
      },
    ]);
  });

  it("computes a revisited place across multiple years", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          exif: { DateTimeOriginal: "2020:03:22 17:45:00" },
          tags: {
            geocode: "36.3286\n138.8951\nAnnaka\nGunma\nAnnaka Shi\nJP\nJapan",
            colors: [[64, 96, 128]],
          } as any,
        }),
        makePhoto({
          exif: { DateTimeOriginal: "2024:03:22 17:45:00" },
          tags: { geocode: "36.3286\n138.8951\nAnnaka\nGunma\nAnnaka Shi\nJP\nJapan" } as any,
        }),
      ]),
    ]);

    expect(stats.revisitedPlaces[0]).toEqual(
      expect.objectContaining({
        label: "Annaka",
        facetId: "city",
        firstYear: 2020,
        lastYear: 2024,
        spanYears: 4,
        timeline: [
          expect.objectContaining({
            year: 2020,
            count: 1,
            // The dominant colour rides along so tiles can show a backdrop;
            // photos without a palette simply omit it.
            photos: [expect.objectContaining({ src: "/test.jpg", swatch: "rgb(64, 96, 128)" })],
          }),
          expect.objectContaining({
            year: 2024,
            count: 1,
            photos: [expect.objectContaining({ src: "/test.jpg" })],
          }),
        ],
      }),
    );
  });

  it("extracts lightweight map points from geotagged photos", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          exif: {
            GPSLatitude: [35, 41, 22],
            GPSLatitudeRef: "N",
            GPSLongitude: [139, 41, 30],
            GPSLongitudeRef: "E",
          },
        }),
        makePhoto({ exif: {} }),
      ]),
    ]);

    expect(stats.mapPoints).toHaveLength(1);
    expect(stats.mapPoints[0]).toEqual(
      expect.objectContaining({
        lat: expect.any(Number),
        lng: expect.any(Number),
      }),
    );
  });

  it("separates neutral tones and finds colour beneath a neutral dominant palette entry", () => {
    const palettes = [
      [[15, 15, 15]],
      [[140, 140, 140]],
      [[240, 240, 240]],
      [
        [15, 15, 15],
        [30, 60, 210],
      ],
      [
        [15, 15, 15],
        [20, 160, 30],
      ],
    ];
    const stats = computePhotoStats([
      makeAlbum(palettes.map((colors) => makePhoto({ tags: { colors } as any }))),
    ]);
    expect(stats.colorStats.find((bucket) => bucket.label === "Dark neutrals")?.count).toBe(3);
    expect(stats.colorStats.find((bucket) => bucket.label === "Mid neutrals")?.count).toBe(1);
    expect(stats.colorStats.find((bucket) => bucket.label === "Light neutrals")?.count).toBe(1);
    expect(stats.accentColorStats?.filter((bucket) => bucket.count > 0)).toEqual([
      { label: "Green", count: 1 },
      { label: "Blue", count: 1 },
    ]);
  });

  it("keeps yearly dominant tones and counts accents beneath neutral palettes", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          exif: { DateTimeOriginal: "2024:01:01 12:00:00" },
          tags: {
            colors: [
              [15, 15, 15],
              [30, 60, 210],
            ],
          } as any,
        }),
        makePhoto({
          exif: { DateTimeOriginal: "2024:02:01 12:00:00" },
          tags: {
            colors: [
              [15, 15, 15],
              [30, 60, 210],
            ],
          } as any,
        }),
        makePhoto({
          exif: { DateTimeOriginal: "2024:03:01 12:00:00" },
          tags: { colors: [[15, 15, 15]] } as any,
        }),
      ]),
    ]);
    expect(stats.colorYearRibbons[0]).toMatchObject({
      total: 3,
      dominantFamily: "Dark neutrals",
      accentFamily: "Blue",
      accentCount: 2,
    });
    expect(stats.colorYearRibbons[0]!.slices[0]).toMatchObject({
      family: "Dark neutrals",
      accent: { family: "Blue", rgb: "rgb(30, 60, 210)" },
    });
    expect(stats.colorYearRibbons[0]!.slices[2]).not.toHaveProperty("accent");
  });

  it("computes dominant color families, examples, and color drift", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          tags: {
            colors: [
              [210, 70, 80],
              [240, 220, 220],
            ],
          } as any,
          exif: {
            DateTimeOriginal: "2021:04:02 12:00:00",
          },
        }),
        makePhoto({
          tags: {
            colors: [
              [80, 120, 220],
              [220, 220, 230],
              [50, 60, 80],
            ],
          } as any,
          exif: {
            DateTimeOriginal: "2024:05:03 12:00:00",
          },
        }),
        makePhoto({
          tags: {
            colors: [[140, 140, 140]],
          } as any,
          exif: {
            DateTimeOriginal: "2024:06:04 12:00:00",
          },
        }),
        makePhoto({ tags: null as any }),
      ]),
    ]);

    expect(stats.colorCoverage).toBeCloseTo(3 / 4);
    expect(stats.colorStats.find((bucket) => bucket.label === "Red")?.count).toBe(1);
    expect(stats.colorStats.find((bucket) => bucket.label === "Blue")?.count).toBe(1);
    expect(stats.colorStats.find((bucket) => bucket.label === "Mid neutrals")?.count).toBe(1);
    expect(stats.paletteSizeStats).toEqual([
      { label: "1", count: 1 },
      { label: "2", count: 1 },
      { label: "3", count: 1 },
      { label: "4", count: 0 },
      { label: "5+", count: 0 },
    ]);
    expect(stats.colorFamilyExamples.find((bucket) => bucket.label === "Red")?.photos[0]).toEqual(
      expect.objectContaining({
        href: "/album/test-album#test.jpg",
        swatch: "rgb(210, 70, 80)",
      }),
    );
    // Newest first, and every year in between: the years with no photographs
    // are rows with nothing in them rather than years the axis skips.
    expect(stats.colorYearStats.map((group) => group.label)).toEqual([
      "2024",
      "2023",
      "2022",
      "2021",
    ]);
    expect(stats.colorYearRibbons).toEqual([
      expect.objectContaining({
        label: "2024",
        total: 2,
        slices: expect.arrayContaining([
          expect.objectContaining({
            rgb: expect.stringMatching(/^rgb\(/),
            family: expect.any(String),
            count: expect.any(Number),
          }),
        ]),
      }),
      expect.objectContaining({ label: "2023", total: 0, slices: [], dominantFamily: null }),
      expect.objectContaining({ label: "2022", total: 0, slices: [] }),
      expect.objectContaining({
        label: "2021",
        total: 1,
      }),
    ]);
    expect(stats.colorDrift).toEqual(
      expect.objectContaining({
        earlyLabel: "2021",
        recentLabel: "2024",
      }),
    );
  });

  it("classifies every colour family, retains examples beyond the first six, and compares multi-year windows", () => {
    const families: Array<{
      id: string;
      rgb: [number, number, number];
      year: number;
      paletteSize?: number;
    }> = [
      { id: "neutral", rgb: [128, 128, 128], year: 2016 },
      { id: "red", rgb: [255, 100, 120], year: 2017 },
      { id: "orange", rgb: [255, 128, 0], year: 2018 },
      { id: "yellow", rgb: [255, 255, 0], year: 2019 },
      { id: "green", rgb: [0, 180, 0], year: 2020 },
      { id: "cyan", rgb: [0, 220, 220], year: 2021 },
      { id: "blue", rgb: [0, 0, 255], year: 2022 },
      { id: "purple", rgb: [128, 0, 255], year: 2023 },
      { id: "pink", rgb: [255, 0, 128], year: 2024, paletteSize: 5 },
    ];
    const photos = families.map(({ id, rgb, year, paletteSize = 1 }) => {
      const photo = makePhoto({
        tags: { colors: Array.from({ length: paletteSize }, () => rgb) },
        exif: { DateTimeOriginal: `${year}:06:15 12:30:00` },
        srcset: id === "pink" ? [{ src: "/pink-thumb.jpg", width: 80, height: 80 }] : [],
      });
      return {
        ...photo,
        id: `${id}.jpg`,
        data: {
          src: `/${id}.jpg`,
          ...(id === "pink" ? { title: "Pink study" } : {}),
        },
      };
    });
    for (let index = 0; index < 6; index += 1) {
      photos.push({
        ...makePhoto({ tags: { colors: [[220, 30, 30]] } }),
        id: `extra-red-${index}.jpg`,
        data: { src: `/extra-red-${index}.jpg` },
      });
    }
    const album = makeAlbum(photos);
    album.blocks.push({ kind: "text", id: "caption", data: { title: "A caption" } });

    const stats = computePhotoStats([album]);

    for (const label of [
      "Mid neutrals",
      "Red",
      "Orange",
      "Yellow",
      "Green",
      "Cyan",
      "Blue",
      "Purple",
      "Pink",
    ]) {
      expect(stats.colorStats.find((bucket) => bucket.label === label)?.count).toBeGreaterThan(0);
    }
    expect(stats.paletteSizeStats.find((bucket) => bucket.label === "5+")?.count).toBe(1);
    expect(stats.colorFamilyExamples.find((bucket) => bucket.label === "Red")?.photos).toHaveLength(
      7,
    );
    expect(stats.colorFamilyExamples.find((bucket) => bucket.label === "Pink")?.photos[0]).toEqual(
      expect.objectContaining({ src: "/pink-thumb.jpg", label: "Pink study" }),
    );
    expect(stats.colorDrift).toEqual(
      expect.objectContaining({ earlyLabel: "2016–2018", recentLabel: "2022–2024" }),
    );
  });

  it("computes time-of-day relationships from local hour, aperture, and ISO", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          exif: {
            DateTimeOriginal: "2024:03:22 17:45:00",
            OffsetTime: "+09:00",
            FNumber: 2,
            ISO: 400,
          },
        }),
        makePhoto({
          exif: {
            DateTimeOriginal: "2024:03:22 17:30:00",
            OffsetTime: "+09:00",
            FNumber: 2.8,
            ISO: 400,
          },
        }),
        makePhoto({
          exif: {
            DateTimeOriginal: "2024:03:22 09:00:00",
            OffsetTime: "+09:00",
            FNumber: 8,
            ISO: 1600,
          },
        }),
        makePhoto({
          exif: {
            DateTimeOriginal: "2024:03:22 17:00:00",
            FNumber: 2,
            ISO: 400,
          },
        }),
      ]),
    ]);

    expect(stats.timeRelationships).toEqual({
      axes: [
        {
          facetId: "hour",
          label: "Time of day",
          buckets: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`),
        },
        {
          facetId: "aperture",
          label: "Aperture",
          buckets: [
            "f/1.8 and faster",
            "around f/2",
            "around f/2.8",
            "around f/4",
            "around f/5.6",
            "f/8–11",
            "f/16+",
          ],
        },
        {
          facetId: "iso",
          label: "ISO",
          buckets: ["≤200", "400", "800", "1600", "3200", "6400+"],
        },
      ],
      paths: expect.arrayContaining([
        {
          values: ["17:00", "around f/2", "400"],
          count: 1,
        },
        {
          values: ["17:00", "around f/2.8", "400"],
          count: 1,
        },
        {
          values: ["09:00", "f/8–11", "1600"],
          count: 1,
        },
      ]),
      total: 3,
    });
  });

  it("top locations uses country from geocode", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({ tags: { geocode: "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan" } }),
        makePhoto({ tags: { geocode: "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan" } }),
        makePhoto({
          tags: { geocode: "48.8566\n2.3522\nParis\nIle-de-France\nParis\nFR\nFrance" },
        }),
        makePhoto({ tags: null as any }),
      ]),
    ]);

    const loc = stats.stringFacets.find((f) => f.facetId === "location")!;
    expect(loc.coverage).toBeCloseTo(3 / 4);
    expect(loc.data[0]).toEqual({ label: "Japan", count: 2 });
    expect(loc.data[1]).toEqual({ label: "France", count: 1 });
  });

  it("computes hierarchical location flow data", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          tags: {
            geocode: "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan",
          },
        }),
        makePhoto({
          tags: {
            geocode: "35.6804\n139.7690\nChiyoda City\nTokyo\nTokyo\nJP\nJapan",
          },
        }),
        makePhoto({
          tags: {
            geocode: "48.8566\n2.3522\nParis\nIle-de-France\nParis\nFR\nFrance",
          },
        }),
      ]),
    ]);

    expect(stats.locationFlow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "country:Japan",
          label: "Japan",
          displayLabel: "Japan",
          count: 2,
          depth: 0,
          facetId: "location",
          facetValue: "Japan",
        }),
        expect.objectContaining({
          id: "region:Japan\u001fTokyo",
          label: "Tokyo",
          displayLabel: "Tokyo",
          count: 2,
          depth: 1,
          facetId: "region",
          facetValue: "Tokyo",
        }),
        expect.objectContaining({
          id: "subregion:Japan\u001fTokyo\u001fTokyo",
          label: "Tokyo",
          displayLabel: "Tokyo",
          count: 2,
          depth: 2,
          facetId: "subregion",
          facetValue: "Tokyo",
        }),
        expect.objectContaining({
          id: "city:Japan\u001fTokyo\u001fTokyo\u001fShinjuku-ku",
          label: "Shinjuku-ku",
          displayLabel: "Shinjuku",
          count: 1,
          depth: 3,
          facetId: "city",
          facetValue: "Shinjuku-ku",
        }),
      ]),
    );

    expect(stats.locationFlow.links).toEqual(
      expect.arrayContaining([
        {
          source: "country:Japan",
          target: "region:Japan\u001fTokyo",
          count: 2,
        },
        {
          source: "region:Japan\u001fTokyo",
          target: "subregion:Japan\u001fTokyo\u001fTokyo",
          count: 2,
        },
        {
          source: "subregion:Japan\u001fTokyo\u001fTokyo",
          target: "city:Japan\u001fTokyo\u001fTokyo\u001fShinjuku-ku",
          count: 1,
        },
      ]),
    );
  });

  it("keeps location flow counts conserved after pruning", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          tags: {
            geocode: "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan",
          },
        }),
        makePhoto({
          tags: {
            geocode: "35.6804\n139.7690\nChiyoda City\nTokyo\nTokyo\nJP\nJapan",
          },
        }),
        makePhoto({
          tags: {
            geocode: "34.6937\n135.5023\nKita-ku\nOsaka\nOsaka\nJP\nJapan",
          },
        }),
        makePhoto({
          tags: {
            geocode: "48.8566\n2.3522\nParis\nIle-de-France\nParis\nFR\nFrance",
          },
        }),
        makePhoto({
          tags: {
            geocode: "48.8584\n2.2945\nParis\nIle-de-France\nParis\nFR\nFrance",
          },
        }),
        makePhoto({
          tags: {
            geocode: "37.5665\n126.9780\nJung-gu\nSeoul\nSeoul\nKR\nSouth Korea",
          },
        }),
        makePhoto({
          tags: { geocode: "1.3521\n103.8198\nSG\nSingapore" },
        }),
      ]),
    ]);

    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();

    stats.locationFlow.links.forEach((link) => {
      outgoing.set(link.source, (outgoing.get(link.source) ?? 0) + link.count);
      incoming.set(link.target, (incoming.get(link.target) ?? 0) + link.count);
    });

    stats.locationFlow.nodes.forEach((node) => {
      if (node.depth === 0) {
        expect(node.count).toBe(outgoing.get(node.id) ?? 0);
        return;
      }

      if (node.depth === 3) {
        expect(node.count).toBe(incoming.get(node.id) ?? 0);
        return;
      }

      expect(node.count).toBe(incoming.get(node.id) ?? 0);
      expect(node.count).toBe(outgoing.get(node.id) ?? 0);
    });
  });

  it("computes technical relationships for focal length, aperture, and ISO", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          exif: {
            FocalLengthIn35mmFormat: 35,
            FNumber: 2,
            ISO: 400,
          },
        }),
        makePhoto({
          exif: {
            FocalLengthIn35mmFormat: 35,
            FNumber: 2,
            ISO: 400,
          },
        }),
        makePhoto({
          exif: {
            FocalLengthIn35mmFormat: 85,
            FNumber: 8,
            ISO: 1600,
          },
        }),
        makePhoto({
          exif: {
            FocalLengthIn35mmFormat: 35,
            FNumber: 2,
          },
        }),
      ]),
    ]);

    expect(stats.technicalRelationships).toEqual(
      expect.objectContaining({
        total: 3,
        axes: [
          expect.objectContaining({
            facetId: "focal-length-35mm",
            label: "Focal length (35mm equiv.)",
          }),
          expect.objectContaining({
            facetId: "aperture",
            label: "Aperture",
            buckets: [
              "f/1.8 and faster",
              "around f/2",
              "around f/2.8",
              "around f/4",
              "around f/5.6",
              "f/8–11",
              "f/16+",
            ],
          }),
          expect.objectContaining({
            facetId: "iso",
            label: "ISO",
          }),
        ],
        paths: expect.arrayContaining([
          expect.objectContaining({
            values: ["35–49mm · normal", "around f/2", "400"],
            count: 2,
          }),
          expect.objectContaining({
            values: ["85–134mm · tele", "f/8–11", "1600"],
            count: 1,
          }),
        ]),
      }),
    );
  });

  it("includes city-states in location flow using hierarchy fallbacks", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({
          tags: {
            geocode: "1.3521\n103.8198\nSingapore\nSG\nSingapore",
          },
        }),
        makePhoto({
          tags: {
            geocode: "1.3000\n103.8000\nTiong Bahru\nSingapore\nSG\nSingapore",
          },
        }),
      ]),
    ]);

    expect(stats.locationFlow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "country:Singapore",
          label: "Singapore",
          count: 2,
          depth: 0,
        }),
        expect.objectContaining({
          id: "region:Singapore\u001fSingapore",
          label: "Singapore",
          count: 2,
          depth: 1,
        }),
      ]),
    );
  });

  it("ranks all revisited places by span, photo count, and label", () => {
    const geocode = (city: string) => `${city}\nRegion\nSubregion\nCountry`;
    const at = (city: string, year: number, suffix: string, title?: string): PhotoBlock => {
      const photo = makePhoto({
        exif: { DateTimeOriginal: `${year}:06:15 12:00:00` },
        tags: { geocode: geocode(city) },
      });
      return {
        ...photo,
        id: `${city}-${suffix}.jpg`,
        data: {
          src: `/${city}-${suffix}.jpg`,
          ...(title ? { title } : {}),
        },
      };
    };
    const photos = [
      at("Longest", 2010, "a"),
      at("Longest", 2024, "b"),
      at("Most", 2015, "a", "First visit"),
      at("Most", 2015, "b"),
      at("Most", 2020, "c"),
      at("Alpha", 2015, "a"),
      at("Alpha", 2020, "b"),
      at("Beta", 2015, "a"),
      at("Beta", 2020, "b"),
      at("Gamma", 2015, "a"),
      at("Gamma", 2020, "b"),
      at("One year", 2020, "a"),
      at("One year", 2020, "b"),
    ];

    const stats = computePhotoStats([makeAlbum(photos)]);
    expect(stats.revisitedPlaces.map((place) => place.label)).toEqual([
      "Longest",
      "Most",
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(stats.revisitedPlaces.find((place) => place.label === "Most")?.photoCount).toBe(3);
    expect(
      stats.revisitedPlaces.find((place) => place.label === "Most")?.timeline[0]?.photos[0],
    ).toEqual(expect.objectContaining({ label: "First visit" }));
  });

  it("excludes malformed and out-of-range years from the collection date range", () => {
    const stats = computePhotoStats([
      makeAlbum([
        makePhoto({ exif: { DateTimeOriginal: "1800:01:01 10:00:00" } }),
        makePhoto({ exif: { DateTimeOriginal: "2201:01:01 10:00:00" } }),
        makePhoto({ exif: { DateTimeOriginal: "not-a-date" } }),
        makePhoto({ exif: { DateTimeOriginal: "2020:01:01 10:00:00" } }),
      ]),
    ]);
    expect(stats.dateRange).toEqual([2020, 2020]);
  });
});

describe("timezone stats", () => {
  // The zone is derived from each photo's coordinates by the indexer, so it is
  // the only trustworthy record of where the clock was — the camera's own
  // OffsetTime is wrong on most of this archive.
  const zoned = (tz_name: string, tz_offset: string, date = "2024:03:22 18:30:00") =>
    makePhoto({
      exif: { DateTimeOriginal: date },
      tags: { tz_name, tz_offset } as PhotoBlock["_build"]["tags"],
    });

  it("counts distinct zones and ranks them by photo count", () => {
    const stats = computePhotoStats([
      makeAlbum([
        zoned("Asia/Tokyo", "+09:00"),
        zoned("Asia/Tokyo", "+09:00"),
        zoned("Asia/Singapore", "+08:00"),
      ]),
    ]);

    expect(stats.timezoneStats.zoneCount).toBe(2);
    expect(stats.timezoneStats.zones[0]).toMatchObject({ name: "Asia/Tokyo", count: 2 });
    expect(stats.timezoneStats.zones[1]).toMatchObject({ name: "Asia/Singapore", count: 1 });
  });

  // Melbourne indexes as both +11:00 and +10:00 across the year. That is one
  // place, not two, so the zone is the identity and the offsets are detail.
  it("keeps a zone whole across its daylight-saving offsets", () => {
    const stats = computePhotoStats([
      makeAlbum([
        zoned("Australia/Melbourne", "+11:00", "2024:01:10 09:00:00"),
        zoned("Australia/Melbourne", "+10:00", "2024:07:10 09:00:00"),
      ]),
    ]);

    expect(stats.timezoneStats.zoneCount).toBe(1);
    expect(stats.timezoneStats.zones[0]?.offsets).toEqual(["+10:00", "+11:00"]);
  });

  // Coverage is measured against dated photos: an undated one could never carry
  // a zone, so counting it would understate the derivation.
  it("reports coverage against dated photos and ignores undated ones", () => {
    const stats = computePhotoStats([
      makeAlbum([
        zoned("Asia/Tokyo", "+09:00"),
        makePhoto({ exif: { DateTimeOriginal: "2024:03:22 18:30:00" } }),
        makePhoto({ exif: {} }),
      ]),
    ]);

    expect(stats.timezoneStats.zoneCount).toBe(1);
    expect(stats.timezoneStats.coverage).toBeCloseTo(0.5);
  });
});

describe("archive gaps", () => {
  const onDate = (date: string) => makePhoto({ exif: { DateTimeOriginal: date } });

  // An archive's silences characterise it as much as its peaks: this one has a
  // four-year opening gap and a two-year one over the pandemic.
  it("finds the longest silences between shooting days, longest first", () => {
    const stats = computePhotoStats([
      makeAlbum([
        onDate("2011:04:05 10:00:00"),
        onDate("2015:05:18 10:00:00"),
        onDate("2015:05:19 10:00:00"),
        onDate("2016:01:01 10:00:00"),
      ]),
    ]);

    expect(stats.archiveGaps[0]).toMatchObject({
      days: 1504,
      fromDate: "2011-04-05",
      toDate: "2015-05-18",
    });
    expect(stats.archiveGaps[1]?.days).toBe(227);
  });

  it("reports no gaps when every photo lands on one day", () => {
    const stats = computePhotoStats([
      makeAlbum([onDate("2024:03:22 10:00:00"), onDate("2024:03:22 18:00:00")]),
    ]);

    expect(stats.archiveGaps).toEqual([]);
  });
});

describe("day of year memories", () => {
  const onDate = (date: string, src: string) => ({
    ...makePhoto({ exif: { DateTimeOriginal: date }, srcset: [{ src, width: 1, height: 1 }] }),
    data: { src },
  });

  it("uses the filename for an untitled photo without an id", () => {
    const photo = onDate("2024:03:22 10:00:00", "/album/memory.jpg");
    const { id: _id, ...withoutId } = photo;
    // Older manifests can omit the id despite the current PhotoBlock contract.
    const stats = computePhotoStats([makeAlbum([withoutId as PhotoBlock])]);

    expect(stats.dayOfYearMemories[0]?.photos[0]?.label).toBe("memory.jpg");
  });

  // The build cannot know what "today" is, so it indexes every calendar day and
  // the browser picks the one it is.
  it("indexes photos by calendar day so the browser can pick today", () => {
    const stats = computePhotoStats([
      makeAlbum([
        onDate("2019:03:22 10:00:00", "/a.jpg"),
        onDate("2024:03:22 10:00:00", "/b.jpg"),
        onDate("2024:07:01 10:00:00", "/c.jpg"),
      ]),
    ]);

    const march22 = stats.dayOfYearMemories.find((entry) => entry.monthDay === "03-22");
    expect(march22?.photos.map((photo) => photo.year)).toEqual([2024, 2019]);
    expect(stats.dayOfYearMemories.find((entry) => entry.monthDay === "07-01")).toBeTruthy();
  });

  // One photo per year, so a single busy day cannot crowd out the other years.
  it("keeps one photo per year and caps how many years it carries", () => {
    const photos = [];
    for (let year = 2015; year <= 2024; year += 1) {
      photos.push(onDate(`${year}:03:22 10:00:00`, `/${year}-a.jpg`));
      photos.push(onDate(`${year}:03:22 12:00:00`, `/${year}-b.jpg`));
    }
    const stats = computePhotoStats([makeAlbum(photos)]);

    const march22 = stats.dayOfYearMemories.find((entry) => entry.monthDay === "03-22")!;
    const years = march22.photos.map((photo) => photo.year);
    expect(new Set(years).size).toBe(years.length);
    expect(years.length).toBeLessThanOrEqual(4);
    expect(years[0]).toBe(2024);
  });
});

describe("clips beside photographs", () => {
  const geocode = "35.6812\n139.7671\nChiyoda\nTokyo\nChiyoda\nJP\nJapan";

  const clip = makeVideo({
    capturedAtLocal: "2023-07-04T10:00:00",
    latDeg: 35.6812,
    lngDeg: 139.7671,
    tags: {
      colors: [[200, 30, 40]],
      geocode,
      tz_name: "Asia/Tokyo",
      tz_offset: "+09:00",
      weather: weatherFixture,
    },
  });

  const photo = makePhoto({
    exif: { DateTimeOriginal: "2024:03:22 18:30:00" },
    tags: { colors: [[10, 20, 30]] },
  });

  const stats = computePhotoStats([makeAlbum([photo, clip])]);

  // A clip is a piece of gallery media like any other, so it is counted in the
  // totals its breakdowns are measured against.
  it("counts a clip in the media total", () => {
    expect(stats.totalPhotos).toBe(2);
    expect(stats.dateRange).toEqual([2023, 2024]);
  });

  // The clip's sidecar recorded the place it was shot, so it stands on the map
  // beside the photographs taken there.
  it("puts a geotagged clip on the map", () => {
    expect(stats.mapPoints).toEqual([{ lat: 35.6812, lng: 139.7671 }]);
  });

  // Its poster is indexed like a photograph's frame, so its colours count in
  // the families and in the examples that stand for each family.
  it("counts the poster's colours in the colour families", () => {
    expect(stats.colorCoverage).toBe(1);
    expect(stats.colorStats.find((bucket) => bucket.label === "Red")).toEqual({
      label: "Red",
      count: 1,
    });
    expect(stats.colorStats.find((bucket) => bucket.label === "Dark neutrals")).toEqual({
      label: "Dark neutrals",
      count: 1,
    });
    expect(
      stats.colorFamilyExamples.find((bucket) => bucket.label === "Red")?.photos[0],
    ).toMatchObject({
      src: "/clip.mov@800.avif",
      href: "/album/test-album#clip.mov",
      swatch: "rgb(200, 30, 40)",
    });
  });

  // The moment comes from the clip's own EXIF, so it appears in the calendar and
  // in "this day in other years" through its poster frame.
  it("dates a clip from its recorded moment", () => {
    expect(stats.calendarCoverage).toBe(1);
    expect(stats.monthStats.find((month) => month.label === "Jul")).toEqual({
      label: "Jul",
      count: 1,
    });
    expect(stats.dayOfYearMemories.find((entry) => entry.monthDay === "07-04")?.photos[0]).toEqual(
      expect.objectContaining({
        year: 2023,
        src: "/clip.mov@800.avif",
        label: "clip.mov",
        swatch: "rgb(200, 30, 40)",
      }),
    );
  });

  // Zone, place and weather ride on the clip's indexed row under the same keys a
  // photograph's do, so they fill the same facets.
  it("reads a clip's zone, geocode and weather off its indexed row", () => {
    expect(stats.timezoneStats.coverage).toBe(0.5);
    expect(stats.timezoneStats.zones[0]).toEqual({
      name: "Asia/Tokyo",
      offsets: ["+09:00"],
      count: 1,
      sharePercent: 100,
    });
    expect(stats.stringFacets.find((facet) => facet.facetId === "location")).toMatchObject({
      coverage: 0.5,
      data: [{ label: "Japan", count: 1 }],
    });
    expect(stats.stringFacets.find((facet) => facet.facetId === "weather-condition")).toMatchObject(
      { coverage: 0.5 },
    );
  });

  // A clip records no camera or lens of its own, so the camera-led statistics
  // are left to stills — except the lens split, which is a partition of all
  // media and so counts the clip where a lensless photograph would land.
  it("leaves camera statistics to photographs", () => {
    const withCamera = computePhotoStats([
      makeAlbum([
        makePhoto({ exif: { Make: "FUJIFILM", Model: "X-T5", LensModel: "XF 23mm F1.4" } }),
        makeVideo({ capturedAtLocal: "2024-01-01T00:00:00" }),
      ]),
    ]);

    expect(
      withCamera.gearFlow.nodes.filter((node) => node.depth === 0).map((node) => node.label),
    ).toEqual(["FUJIFILM X-T5"]);
    expect(withCamera.lensTypeStats).toEqual({ prime: 1, zoom: 0, unknown: 1 });
  });

  // A poster cannot prove how the clip was framed, so framing keeps its own
  // coverage over stills rather than inventing dimensions for the clip.
  it("does not let a poster stand in for a still's framing", () => {
    const framed = computePhotoStats([
      makeAlbum([
        makePhoto({ width: 6000, height: 4000 }),
        makeVideo({ capturedAtLocal: "2024-01-01T00:00:00" }),
      ]),
    ]);

    expect(framed.stringFacets.find((facet) => facet.facetId === "aspect-ratio")).toMatchObject({
      coverage: 1,
      data: [{ label: "3:2", count: 1 }],
    });
  });
});
