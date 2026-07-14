import { RandomPhotoRow } from "../components/search/api";
import {
  decideRemixCompanionCount,
  describeRemix,
  getRemixSwatchRgb,
  getTimeAffinityScore,
  haversineKm,
  pickRemixCompanions,
  rollRemixLayoutCount,
  rollRemixStrategy,
  timeAwareShufflePhotos,
  VECTOR_REMIX_STRATEGIES,
} from "./slideshowAmbient";

// extractDateFromExifString expects keys formatted as "EXIF DateTimeOriginal"
// with values in YYYY:MM:DD HH:MM:SS — anything else parses to null, which
// would silently fall back to the no-EXIF weight in timeAwareShufflePhotos.
const formatExifDate = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
};

const makePhoto = (path: string, exifDate?: Date): RandomPhotoRow => ({
  path,
  exif: exifDate ? `EXIF DateTimeOriginal: ${formatExifDate(exifDate)}` : "",
  geocode: "",
});

// reverse_geocode's format: country code, city, lat, lng, population, admin1,
// admin2, country name — one per line. When admin1 is omitted the slot is
// filled with the country, which extractAdmin1 treats as "no distinct region"
// so same-region falls cleanly through to same-country.
const makeGeocode = (
  countryCode: string,
  city: string,
  country: string,
  admin1: string = country,
): string => [countryCode, city, "0.0", "0.0", "0", admin1, "", country].join("\n");

// `colors` is the Python-tuple serialisation produced by the indexer.
const formatColors = (rgbs: Array<[number, number, number]>): string =>
  `[${rgbs.map(([r, g, b]) => `(${r}, ${g}, ${b})`).join(", ")}]`;

describe("getTimeAffinityScore", () => {
  test("uses the current local wall-clock time when now is omitted", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 4, 15, 14, 30));
    try {
      expect(getTimeAffinityScore(new Date(2024, 4, 15, 14, 30))).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("hour-of-day match scores higher than mismatch", () => {
    const now = new Date(2026, 4, 15, 14, 30); // 14:30 mid-May
    const matching = new Date(2024, 4, 10, 14, 0); // 14:00, same month
    const opposite = new Date(2024, 4, 10, 2, 0); // 02:00, same month
    expect(getTimeAffinityScore(matching, now)).toBeGreaterThan(
      getTimeAffinityScore(opposite, now),
    );
  });

  test("same season scores higher than opposite season", () => {
    const now = new Date(2026, 6, 15, 12, 0); // mid-July
    const summer = new Date(2024, 6, 10, 12, 0); // mid-July (same season + hour)
    const winter = new Date(2024, 0, 10, 12, 0); // mid-January (opposite season, same hour)
    expect(getTimeAffinityScore(summer, now)).toBeGreaterThan(getTimeAffinityScore(winter, now));
  });

  test("score is bounded in [0.02, 1]", () => {
    const now = new Date(2026, 0, 1, 0, 0);
    const sample = new Date(2024, 6, 15, 12, 0);
    const score = getTimeAffinityScore(sample, now);
    expect(score).toBeGreaterThanOrEqual(0.02);
    expect(score).toBeLessThanOrEqual(1);
  });

  test("single-axis match (right hour, wrong season) scores well below 0.5", () => {
    // Old arithmetic-mean formula gave 0.5 here, which felt much higher than
    // the user's intuition. Multiplicative combine should put it under 0.05.
    const now = new Date(2026, 4, 15, 14, 0); // May at 2pm
    const rightHourWrongSeason = new Date(2024, 10, 15, 14, 0); // Nov 2pm
    const score = getTimeAffinityScore(rightHourWrongSeason, now);
    expect(score).toBeLessThan(0.1);
  });

  test("both-axes match scores well above single-axis match", () => {
    const now = new Date(2026, 4, 15, 14, 0);
    const bothMatch = new Date(2024, 4, 10, 14, 30);
    const oneMatch = new Date(2024, 4, 10, 2, 30); // same month, opposite hour
    expect(getTimeAffinityScore(bothMatch, now)).toBeGreaterThan(
      getTimeAffinityScore(oneMatch, now) * 5,
    );
  });

  test("wraparound: 23:30 and 00:30 score close (cyclic hour distance)", () => {
    const lateNight = new Date(2024, 5, 10, 23, 30);
    const noon = new Date(2024, 5, 10, 12, 0); // 11.5h cyclic away
    const refNow = new Date(2026, 5, 10, 0, 30);
    expect(getTimeAffinityScore(lateNight, refNow)).toBeGreaterThan(
      getTimeAffinityScore(noon, refNow),
    );
  });

  test("Dec/Jan wraparound: month distance is 1 not 11", () => {
    const dec = new Date(2024, 11, 15, 12, 0);
    const jul = new Date(2024, 6, 15, 12, 0);
    const janNow = new Date(2026, 0, 15, 12, 0);
    expect(getTimeAffinityScore(dec, janNow)).toBeGreaterThan(getTimeAffinityScore(jul, janNow));
  });
});

describe("timeAwareShufflePhotos", () => {
  test("uses the current time and runtime randomness by default", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 1, 14));
    const random = jest.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const photo = makePhoto("data/albums/a/p1.jpg", new Date(2024, 5, 1, 14));
      expect(timeAwareShufflePhotos([photo])).toEqual([photo]);
      expect(random).toHaveBeenCalled();
    } finally {
      random.mockRestore();
      jest.useRealTimers();
    }
  });

  test("returns the same set of photos", () => {
    const photos = [
      makePhoto("data/albums/a/p1.jpg", new Date(2024, 0, 1, 9)),
      makePhoto("data/albums/a/p2.jpg", new Date(2024, 5, 1, 14)),
      makePhoto("data/albums/a/p3.jpg", new Date(2024, 9, 1, 19)),
    ];
    const out = timeAwareShufflePhotos(photos, new Date(2026, 5, 1, 14));
    expect(new Set(out.map((p) => p.path))).toEqual(new Set(photos.map((p) => p.path)));
  });

  test("photos without parseable EXIF still appear in the result", () => {
    const photos = [
      makePhoto("data/albums/a/p1.jpg"),
      makePhoto("data/albums/a/p2.jpg", new Date(2024, 5, 1, 14)),
    ];
    const out = timeAwareShufflePhotos(photos, new Date(2026, 5, 1, 14));
    expect(out).toHaveLength(2);
  });

  test("high-affinity photos dominate the head of the queue over many low-affinity ones", () => {
    // 200 off-band photos (Jan 3am) versus 5 on-band photos (same hour and
    // month as now). With cubed weighting the on-band photos should
    // overwhelmingly own the top of the queue even though they're 40× rarer
    // in the pool. With linear weighting this property fails — the cumulative
    // weight of the off-band photos would dominate the top.
    const now = new Date(2026, 6, 15, 14, 30); // mid-July at 14:30
    const offBand: RandomPhotoRow[] = [];
    for (let i = 0; i < 200; i += 1) {
      offBand.push(makePhoto(`data/albums/winter/${i}.jpg`, new Date(2024, 0, 1, 3, 0)));
    }
    const onBand: RandomPhotoRow[] = [];
    for (let i = 0; i < 5; i += 1) {
      onBand.push(makePhoto(`data/albums/summer/${i}.jpg`, new Date(2024, 6, 10, 14, 0)));
    }

    // Average across many trials to smooth out single-shuffle variance.
    let topTenOnBandTotal = 0;
    const trials = 20;
    for (let t = 0; t < trials; t += 1) {
      const out = timeAwareShufflePhotos([...offBand, ...onBand], now);
      topTenOnBandTotal += out
        .slice(0, 10)
        .filter((p) => p.path.startsWith("data/albums/summer/")).length;
    }
    const avgTopTenOnBand = topTenOnBandTotal / trials;
    // We have 5 on-band photos out of 205 total. With pure-random ordering
    // we'd expect ~10*(5/205) = 0.24 on-band photos in the top 10. With
    // the sharpened bias they should average above 3 (most of them, most
    // of the time).
    expect(avgTopTenOnBand).toBeGreaterThan(3);
  });
});

describe("rollRemixLayoutCount", () => {
  test("uses Math.random by default", () => {
    const random = jest.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      expect(rollRemixLayoutCount()).toBe(1);
    } finally {
      random.mockRestore();
    }
  });

  test("returns 1 (2-up) when roll < 0.7", () => {
    expect(rollRemixLayoutCount(() => 0.0)).toBe(1);
    expect(rollRemixLayoutCount(() => 0.69)).toBe(1);
  });

  test("returns 2 (3-up) when roll in [0.7, 0.95)", () => {
    expect(rollRemixLayoutCount(() => 0.7)).toBe(2);
    expect(rollRemixLayoutCount(() => 0.94)).toBe(2);
  });

  test("returns 3 (4-up) when roll >= 0.95", () => {
    expect(rollRemixLayoutCount(() => 0.95)).toBe(3);
    expect(rollRemixLayoutCount(() => 0.99)).toBe(3);
  });
});

describe("decideRemixCompanionCount", () => {
  test("uses Math.random when no random source is supplied", () => {
    const random = jest.spyOn(Math, "random").mockReturnValue(1);
    try {
      expect(decideRemixCompanionCount(0.03)).toBe(0);
    } finally {
      random.mockRestore();
    }
  });

  test("returns 0 when first random draw exceeds probability", () => {
    expect(decideRemixCompanionCount(0.03, () => 0.5)).toBe(0);
    expect(decideRemixCompanionCount(0.03, () => 0.03)).toBe(0);
  });

  test("returns 1 (2-up) when below probability and layout roll < 0.7", () => {
    const random = jest
      .fn()
      .mockReturnValueOnce(0.01) // pass remix probability
      .mockReturnValueOnce(0.5); // 2-up band
    expect(decideRemixCompanionCount(0.03, random)).toBe(1);
  });

  test("returns 2 (3-up) when layout roll lands in [0.7, 0.95)", () => {
    const random = jest.fn().mockReturnValueOnce(0.01).mockReturnValueOnce(0.85);
    expect(decideRemixCompanionCount(0.03, random)).toBe(2);
  });

  test("returns 3 (4-up) when layout roll >= 0.95", () => {
    const random = jest.fn().mockReturnValueOnce(0.01).mockReturnValueOnce(0.97);
    expect(decideRemixCompanionCount(0.03, random)).toBe(3);
  });

  test("rate roughly matches probability over many trials", () => {
    let seed = 1234;
    const fakeRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const trials = 5000;
    let hits = 0;
    for (let i = 0; i < trials; i += 1) {
      if (decideRemixCompanionCount(0.05, fakeRandom) > 0) hits += 1;
    }
    const rate = hits / trials;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.08);
  });
});

describe("haversineKm", () => {
  test("returns zero for one point and the expected great-circle distance", () => {
    expect(haversineKm(51.5, -0.1, 51.5, -0.1)).toBe(0);
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.19, 1);
  });
});

describe("rollRemixStrategy", () => {
  test.each([
    [0.1, "similar"],
    [0.25, "same-album"],
    [0.35, "proximity"],
    [0.45, "dominant-colour"],
    [0.55, "juxtapose"],
    [0.63, "anniversary"],
    [0.7, "golden-hour"],
    [0.77, "same-city"],
    [0.82, "same-region"],
    [0.87, "same-year"],
    [0.91, "shared-camera"],
    [0.945, "same-day-of-year"],
    [0.97, "same-country"],
    [0.985, "same-decade"],
    [0.995, "random"],
  ] as const)("maps a roll of %s to %s", (roll, strategy) => {
    expect(rollRemixStrategy(() => roll)).toBe(strategy);
  });

  test("uses Math.random by default", () => {
    const random = jest.spyOn(Math, "random").mockReturnValue(0.1);
    try {
      expect(rollRemixStrategy()).toBe("similar");
    } finally {
      random.mockRestore();
    }
  });

  test("identifies the two strategies that require vector search", () => {
    expect(VECTOR_REMIX_STRATEGIES).toEqual(new Set(["similar", "juxtapose"]));
  });
});

describe("pickRemixCompanions", () => {
  const seed = makePhoto("data/albums/japan/seed.jpg");
  const sameAlbumPool = [
    makePhoto("data/albums/japan/a.jpg"),
    makePhoto("data/albums/japan/b.jpg"),
    makePhoto("data/albums/japan/c.jpg"),
  ];
  const otherAlbumPool = [
    makePhoto("data/albums/iceland/x.jpg"),
    makePhoto("data/albums/iceland/y.jpg"),
  ];

  test("returns empty pick when count is 0", () => {
    const pick = pickRemixCompanions(seed, sameAlbumPool, 0);
    expect(pick.companions).toEqual([]);
  });

  test("returns empty pick when pool is too small", () => {
    const pick = pickRemixCompanions(seed, [seed], 1);
    expect(pick.companions).toEqual([]);
  });

  test("never includes the seed itself", () => {
    const pick = pickRemixCompanions(seed, [seed, ...sameAlbumPool], 2);
    expect(pick.companions.find((p) => p.path === seed.path)).toBeUndefined();
  });

  test("returns the rolled strategy on a successful pick", () => {
    // Force `same-album` first by rigging the weighted roll: the first random
    // draw needs to land in the same-album band [0, 0.28*total].
    const random = jest
      .fn()
      .mockReturnValueOnce(0.01) // strategy roll → first weighted band (same-album)
      .mockReturnValue(0.5); // subsequent draws for the shuffle
    const pick = pickRemixCompanions(seed, [...sameAlbumPool, ...otherAlbumPool], 2, random);
    expect(pick.strategy).toBe("same-album");
    for (const photo of pick.companions) {
      expect(photo.path.startsWith("data/albums/japan/")).toBe(true);
    }
  });

  test("uses a caller-supplied strategy instead of rolling its own", () => {
    // The slideshow rolls the strategy once (to choose between the async vector
    // path and this sync path) and passes it down; pickRemixCompanions must
    // honour it rather than re-rolling and funnelling failed rolls into
    // same-album. Here a fresh internal roll would land on same-album, so the
    // preset is the only thing that can produce same-year.
    const y2020 = new Date(2020, 5, 1, 12, 0);
    const seedDated = makePhoto("data/albums/japan/seed.jpg", y2020);
    const pool = [
      seedDated,
      makePhoto("data/albums/japan/a.jpg", y2020),
      makePhoto("data/albums/japan/b.jpg", y2020),
      makePhoto("data/albums/iceland/x.jpg", y2020),
    ];
    const random = jest.fn().mockReturnValue(0); // would roll the first band
    const pick = pickRemixCompanions(seedDated, pool, 2, random, "same-year");
    expect(pick.strategy).toBe("same-year");
  });

  test("falls through to a later strategy when the rolled one has too few candidates", () => {
    // Land the roll in the proximity band [0.40, 0.48). Photos lack GPS, so
    // proximity returns []; fallback walks down to same-album.
    const random = jest.fn().mockReturnValueOnce(0.44).mockReturnValue(0.5);
    const pick = pickRemixCompanions(seed, [...sameAlbumPool, ...otherAlbumPool], 2, random);
    expect(pick.companions).toHaveLength(2);
    expect(pick.strategy).not.toBe("proximity");
  });

  test("returns no duplicates", () => {
    const pick = pickRemixCompanions(seed, [...sameAlbumPool, ...otherAlbumPool], 2);
    expect(new Set(pick.companions.map((p) => p.path)).size).toBe(pick.companions.length);
  });

  test("proximity strategy picks from the seed's nearest neighbours", () => {
    // EXIF parser treats coords as DMS-summed (deg + min/60 + sec/3600), so
    // [0, 0, i*36] = i*0.01° ≈ i*1.11km along longitude.
    const makeGpsPhoto = (path: string, lngSec: number): RandomPhotoRow => ({
      path,
      exif: [
        "GPS GPSLatitude: 0,0,0",
        "GPS GPSLatitudeRef: N",
        `GPS GPSLongitude: 0,0,${lngSec}`,
        "GPS GPSLongitudeRef: E",
      ].join("\n"),
      geocode: "",
    });
    const gpsSeed = makeGpsPhoto("data/albums/x/seed.jpg", 0);
    // 30 candidates fanning east of the seed; the 8 closest are i=1..8.
    const candidates: RandomPhotoRow[] = [];
    for (let i = 1; i <= 30; i += 1) {
      candidates.push(makeGpsPhoto(`data/albums/x/${i}.jpg`, i * 36));
    }

    // Force proximity by landing the weighted roll in [0.32, 0.42) under
    // current weights (similar 0.20 + same-album 0.12 = 0.32; proximity 0.10).
    const random = jest.fn().mockReturnValueOnce(0.4).mockReturnValue(0.5);
    const pick = pickRemixCompanions(gpsSeed, candidates, 2, random);
    expect(pick.strategy).toBe("proximity");

    for (const photo of pick.companions) {
      const match = photo.path.match(/\/(\d+)\.jpg$/);
      expect(match).not.toBeNull();
      const index = Number(match![1]);
      // Within the 8 nearest — earlier code would pick from up to 27 within
      // the 50km cap, letting distant pairs through.
      expect(index).toBeLessThanOrEqual(8);
    }
  });

  test("shared-camera strategy matches on Make + Model", () => {
    const withCamera = (path: string, make: string, model: string): RandomPhotoRow => ({
      path,
      exif: `Image Make: ${make}\nImage Model: ${model}`,
      geocode: "",
    });
    const seedX100 = withCamera("data/albums/a/seed.jpg", "FUJIFILM", "X100V");
    const sameBody = withCamera("data/albums/b/1.jpg", "FUJIFILM", "X100V");
    const differentBody = withCamera("data/albums/c/2.jpg", "FUJIFILM", "X-T20");
    const differentMake = withCamera("data/albums/d/3.jpg", "Sony", "A7IV");
    const noCamera: RandomPhotoRow = {
      path: "data/albums/e/4.jpg",
      exif: "",
      geocode: "",
    };

    // Cumulative through prior strategies under current weights:
    // similar 0.30 + same-album 0.10 + proximity 0.08 + dominant-colour 0.08 +
    // juxtapose 0.07 + anniversary 0.06 + golden-hour 0.05 + same-city 0.06 +
    // same-region 0.05 + same-year 0.04 = 0.89. shared-camera adds 0.04
    // → [0.89, 0.93). 0.91 lands inside.
    const random = jest.fn().mockReturnValueOnce(0.91).mockReturnValue(0.5);
    const pick = pickRemixCompanions(
      seedX100,
      [sameBody, differentBody, differentMake, noCamera],
      1,
      random,
    );
    expect(pick.strategy).toBe("shared-camera");
    expect(pick.companions[0]?.path).toBe("data/albums/b/1.jpg");
  });

  test("same-city strategy matches the city line of the geocode", () => {
    const seedTokyo: RandomPhotoRow = {
      path: "data/albums/japan/seed.jpg",
      exif: "",
      geocode: makeGeocode("JP", "Tokyo", "Japan"),
    };
    const sameCity: RandomPhotoRow = {
      path: "data/albums/japan/a.jpg",
      exif: "",
      geocode: makeGeocode("JP", "Tokyo", "Japan"),
    };
    const sameCountry: RandomPhotoRow = {
      path: "data/albums/japan/b.jpg",
      exif: "",
      geocode: makeGeocode("JP", "Osaka", "Japan"),
    };
    const elsewhere: RandomPhotoRow = {
      path: "data/albums/london/c.jpg",
      exif: "",
      geocode: makeGeocode("GB", "London", "United Kingdom"),
    };

    // Cumulative under current weights:
    // similar 0.30 + same-album 0.10 + proximity 0.08 + dominant-colour 0.08 +
    // juxtapose 0.07 + anniversary 0.06 + golden-hour 0.05 = 0.74.
    // same-city adds 0.06 → [0.74, 0.80). 0.76 lands in same-city.
    const random = jest.fn().mockReturnValueOnce(0.76).mockReturnValue(0.5);
    const pick = pickRemixCompanions(seedTokyo, [sameCity, sameCountry, elsewhere], 1, random);
    expect(pick.strategy).toBe("same-city");
    expect(pick.companions[0]?.path).toBe("data/albums/japan/a.jpg");
  });

  test("same-city tolerates a numeric field before the city", () => {
    const seedTokyo: RandomPhotoRow = {
      path: "data/albums/japan/seed.jpg",
      exif: "",
      geocode: "JP\n35.0\nTokyo\nJapan",
    };
    const sameCity: RandomPhotoRow = {
      path: "data/albums/other/a.jpg",
      exif: "",
      geocode: "JP\n35.1\nTokyo\nJapan",
    };

    const pick = pickRemixCompanions(seedTokyo, [sameCity, seedTokyo], 1, () => 0.5, "same-city");
    expect(pick).toMatchObject({ strategy: "same-city", companions: [sameCity] });
  });

  test("same-region matches admin1 without widening to the whole country", () => {
    const seedHokkaido: RandomPhotoRow = {
      path: "data/albums/a/seed.jpg",
      exif: "",
      geocode: makeGeocode("JP", "Sapporo", "Japan", "Hokkaido"),
    };
    const hokkaido = {
      ...makePhoto("data/albums/b/hokkaido.jpg"),
      geocode: makeGeocode("JP", "Otaru", "Japan", "Hokkaido"),
    };
    const tokyo = {
      ...makePhoto("data/albums/c/tokyo.jpg"),
      geocode: makeGeocode("JP", "Tokyo", "Japan", "Tokyo"),
    };

    const pick = pickRemixCompanions(
      seedHokkaido,
      [seedHokkaido, hokkaido, tokyo],
      1,
      () => 0.5,
      "same-region",
    );
    expect(pick).toMatchObject({ strategy: "same-region", companions: [hokkaido] });
  });

  test("same-country matches across regions", () => {
    const seedHokkaido: RandomPhotoRow = {
      path: "data/albums/a/seed.jpg",
      exif: "",
      geocode: makeGeocode("JP", "Sapporo", "Japan", "Hokkaido"),
    };
    const tokyo = {
      ...makePhoto("data/albums/b/tokyo.jpg"),
      geocode: makeGeocode("JP", "Tokyo", "Japan", "Tokyo"),
    };
    const london = {
      ...makePhoto("data/albums/c/london.jpg"),
      geocode: makeGeocode("GB", "London", "United Kingdom", "England"),
    };

    const pick = pickRemixCompanions(
      seedHokkaido,
      [seedHokkaido, tokyo, london],
      1,
      () => 0.5,
      "same-country",
    );
    expect(pick).toMatchObject({ strategy: "same-country", companions: [tokyo] });
  });

  test("same-day-of-year strategy matches month+day across different years", () => {
    const seedDate = makePhoto("data/albums/a/seed.jpg", new Date(2024, 4, 24, 10, 0));
    const sameDayDifferentYear = makePhoto("data/albums/b/1.jpg", new Date(2022, 4, 24, 18, 0));
    const sameDaySameYear = makePhoto("data/albums/c/2.jpg", new Date(2024, 4, 24, 14, 0));
    const sameMonthDifferentDay = makePhoto("data/albums/d/3.jpg", new Date(2022, 4, 25, 10, 0));

    // same-day-of-year cumulative band: [0.93, 0.96) — 0.94 lands inside.
    const random = jest.fn().mockReturnValueOnce(0.94).mockReturnValue(0.5);
    const pick = pickRemixCompanions(
      seedDate,
      [
        seedDate,
        sameDayDifferentYear,
        sameDaySameYear,
        sameMonthDifferentDay,
        makePhoto("undated"),
      ],
      1,
      random,
    );
    expect(pick.strategy).toBe("same-day-of-year");
    expect(pick.companions[0]?.path).toBe("data/albums/b/1.jpg");
  });

  test("dominant-colour strategy matches photos whose dominant colour is within deltaE 18", () => {
    const seedRed: RandomPhotoRow = {
      path: "data/albums/a/seed.jpg",
      exif: "",
      geocode: "",
      // Dominant colour first: vivid red.
      colors: formatColors([
        [220, 30, 30],
        [80, 80, 80],
      ]),
    };
    const nearRed: RandomPhotoRow = {
      path: "data/albums/b/1.jpg",
      exif: "",
      geocode: "",
      colors: formatColors([
        [210, 40, 35],
        [40, 40, 40],
      ]),
    };
    const blue: RandomPhotoRow = {
      path: "data/albums/c/2.jpg",
      exif: "",
      geocode: "",
      colors: formatColors([
        [20, 60, 200],
        [200, 200, 200],
      ]),
    };
    const noColours: RandomPhotoRow = {
      path: "data/albums/d/3.jpg",
      exif: "",
      geocode: "",
    };

    // dominant-colour cumulative band: [0.48, 0.56) — 0.52 lands inside.
    const random = jest.fn().mockReturnValueOnce(0.52).mockReturnValue(0.5);
    const pick = pickRemixCompanions(seedRed, [seedRed, nearRed, blue, noColours], 1, random);
    expect(pick.strategy).toBe("dominant-colour");
    expect(pick.companions[0]?.path).toBe("data/albums/b/1.jpg");
  });

  test("anniversary matches the same week in other years, including year wraparound", () => {
    const seedDate = makePhoto("data/albums/a/seed.jpg", new Date(2024, 0, 2, 10));
    const previousNewYear = makePhoto("data/albums/b/new-year.jpg", new Date(2022, 11, 31, 10));
    const sameWeek = makePhoto("data/albums/c/same-week.jpg", new Date(2021, 0, 5, 10));
    const sameYear = makePhoto("data/albums/d/same-year.jpg", new Date(2024, 0, 3, 10));
    const tooFar = makePhoto("data/albums/e/far.jpg", new Date(2020, 0, 12, 10));
    const undated = makePhoto("data/albums/f/undated.jpg");

    const pick = pickRemixCompanions(
      seedDate,
      [seedDate, previousNewYear, sameWeek, sameYear, tooFar, undated],
      2,
      () => 0.5,
      "anniversary",
    );
    expect(pick.strategy).toBe("anniversary");
    expect(new Set(pick.companions)).toEqual(new Set([previousNewYear, sameWeek]));
  });

  test("same-decade matches other years in the seed's decade", () => {
    const seedDate = makePhoto("data/albums/a/seed.jpg", new Date(2024, 0, 2));
    const early = makePhoto("data/albums/b/early.jpg", new Date(2021, 5, 1));
    const late = makePhoto("data/albums/c/late.jpg", new Date(2029, 5, 1));
    const sameYear = makePhoto("data/albums/d/same-year.jpg", new Date(2024, 5, 1));
    const priorDecade = makePhoto("data/albums/e/prior.jpg", new Date(2019, 5, 1));
    const undated = makePhoto("data/albums/f/undated.jpg");

    const pick = pickRemixCompanions(
      seedDate,
      [seedDate, early, late, sameYear, priorDecade, undated],
      2,
      () => 0.5,
      "same-decade",
    );
    expect(pick.strategy).toBe("same-decade");
    expect(new Set(pick.companions)).toEqual(new Set([early, late]));
  });

  test("golden-hour matches sunrise and sunset while rejecting ordinary hours", () => {
    const seedDate = makePhoto("data/albums/a/seed.jpg", new Date(2024, 5, 1, 6));
    const sunrise = makePhoto("data/albums/b/sunrise.jpg", new Date(2023, 5, 1, 5));
    const sunset = makePhoto("data/albums/c/sunset.jpg", new Date(2022, 5, 1, 19));
    const midday = makePhoto("data/albums/d/midday.jpg", new Date(2021, 5, 1, 12));
    const undated = makePhoto("data/albums/e/undated.jpg");

    const pick = pickRemixCompanions(
      seedDate,
      [seedDate, sunrise, sunset, midday, undated],
      2,
      () => 0.5,
      "golden-hour",
    );
    expect(pick.strategy).toBe("golden-hour");
    expect(new Set(pick.companions)).toEqual(new Set([sunrise, sunset]));
  });

  test("golden-hour falls back when the seed was shot outside its time bands", () => {
    const middaySeed = makePhoto("data/albums/a/seed.jpg", new Date(2024, 5, 1, 12));
    const candidate = makePhoto("data/albums/b/candidate.jpg", new Date(2010, 8, 10, 6));
    expect(
      pickRemixCompanions(middaySeed, [middaySeed, candidate], 1, () => 0.5, "golden-hour"),
    ).toMatchObject({ strategy: "random", companions: [candidate] });
  });

  test("proximity ignores the seed, missing GPS, and candidates outside 50 km", () => {
    const gpsPhoto = (path: string, longitudeSeconds: number): RandomPhotoRow => ({
      path,
      exif: [
        "GPS GPSLatitude: 0,0,0",
        "GPS GPSLatitudeRef: N",
        `GPS GPSLongitude: 0,0,${longitudeSeconds}`,
        "GPS GPSLongitudeRef: E",
      ].join("\n"),
      geocode: "",
    });
    const gpsSeed = gpsPhoto("data/albums/a/seed.jpg", 0);
    const nearby = gpsPhoto("data/albums/b/nearby.jpg", 36);
    const distant = gpsPhoto("data/albums/c/distant.jpg", 3600);
    const noGps = makePhoto("data/albums/d/no-gps.jpg");

    const pick = pickRemixCompanions(
      gpsSeed,
      [gpsSeed, nearby, distant, noGps],
      1,
      () => 0.5,
      "proximity",
    );
    expect(pick).toMatchObject({ strategy: "proximity", companions: [nearby] });
  });

  test("shared-camera accepts make-only EXIF and ignores malformed lines", () => {
    const seedCamera: RandomPhotoRow = {
      path: "data/albums/a/seed.jpg",
      exif: "malformed line\nEXIF ISO: 100\nImage Make: Pentax",
      geocode: "",
    };
    const sameCamera = {
      ...makePhoto("data/albums/b/same.jpg"),
      exif: "Image Make: Pentax",
    };
    const modelOnly = {
      ...makePhoto("data/albums/c/model.jpg"),
      exif: "Image Model: Pentax",
    };

    const pick = pickRemixCompanions(
      seedCamera,
      [seedCamera, sameCamera, modelOnly],
      1,
      () => 0.5,
      "shared-camera",
    );
    expect(pick).toMatchObject({ strategy: "shared-camera", companions: [sameCamera] });
  });

  test.each([
    ["same-album", makePhoto("seed.jpg")],
    ["same-year", makePhoto("data/albums/a/seed.jpg")],
    ["same-region", makePhoto("data/albums/a/seed.jpg")],
    ["same-country", { ...makePhoto("data/albums/a/seed.jpg"), geocode: "1\n2\n3" }],
    ["same-city", { ...makePhoto("data/albums/a/seed.jpg"), geocode: "1\n2\n3" }],
    ["same-day-of-year", makePhoto("data/albums/a/seed.jpg")],
    ["dominant-colour", makePhoto("data/albums/a/seed.jpg")],
    [
      "dominant-colour",
      { ...makePhoto("data/albums/a/seed.jpg"), colors: "not a serialised palette" },
    ],
    ["anniversary", makePhoto("data/albums/a/seed.jpg")],
    ["same-decade", makePhoto("data/albums/a/seed.jpg")],
    ["proximity", makePhoto("data/albums/a/seed.jpg")],
    ["golden-hour", makePhoto("data/albums/a/seed.jpg")],
    ["shared-camera", makePhoto("data/albums/a/seed.jpg")],
    ["shared-camera", { ...makePhoto("data/albums/a/seed.jpg"), exif: "EXIF ISO: 100" }],
  ] as const)(
    "falls back from %s when the seed lacks required metadata",
    (strategy, missingSeed) => {
      const candidate = makePhoto("data/albums/b/candidate.jpg");
      const pick = pickRemixCompanions(
        missingSeed,
        [missingSeed, candidate],
        1,
        () => 0.5,
        strategy,
      );
      expect(pick).toMatchObject({ strategy: "random", companions: [candidate] });
    },
  );

  test("returns empty when duplicate seed paths leave no genuine fallback candidate", () => {
    const duplicateSeed = { ...seed };
    expect(pickRemixCompanions(seed, [seed, duplicateSeed], 1, () => 0.5, "random")).toEqual({
      companions: [],
      strategy: "random",
    });
  });

  test("similar strategy is a placeholder that falls through to other strategies", () => {
    // There's no `similar` band in STRATEGY_WEIGHTS, so it can only be
    // reached via the fallback iteration order — and since its filter
    // returns [], it should never be the *chosen* strategy.
    for (let i = 0; i < 50; i += 1) {
      const pick = pickRemixCompanions(seed, [...sameAlbumPool, ...otherAlbumPool], 1);
      expect(pick.strategy).not.toBe("similar");
      expect(pick.strategy).not.toBe("juxtapose");
    }
  });
});

describe("describeRemix", () => {
  test("proximity returns a metric distance string from GPS metadata", () => {
    // 0.01° latitude ≈ 1.11 km. Two photos 0.01° apart should land in the km bucket.
    const photos: RandomPhotoRow[] = [
      {
        path: "data/albums/a/1.jpg",
        exif: [
          "GPS GPSLatitude: 0,0,0",
          "GPS GPSLatitudeRef: N",
          "GPS GPSLongitude: 0,0,0",
          "GPS GPSLongitudeRef: E",
        ].join("\n"),
        geocode: "",
      },
      {
        path: "data/albums/a/2.jpg",
        exif: [
          "GPS GPSLatitude: 0,0,36",
          "GPS GPSLatitudeRef: N",
          "GPS GPSLongitude: 0,0,0",
          "GPS GPSLongitudeRef: E",
        ].join("\n"),
        geocode: "",
      },
    ];
    const desc = describeRemix("proximity", photos);
    expect(desc).not.toBeNull();
    expect(desc).toMatch(/^within /);
  });

  test("proximity returns null when fewer than two photos have GPS", () => {
    expect(describeRemix("proximity", [makePhoto("a/1.jpg")])).toBeNull();
  });

  test("proximity formats metre, decimal-kilometre, and rounded-kilometre spreads", () => {
    const gpsPhoto = (path: string, latitudeSeconds: number): RandomPhotoRow => ({
      path,
      exif: [
        `GPS GPSLatitude: 0,0,${latitudeSeconds}`,
        "GPS GPSLatitudeRef: N",
        "GPS GPSLongitude: 0,0,0",
        "GPS GPSLongitudeRef: E",
      ].join("\n"),
      geocode: "",
    });
    const origin = gpsPhoto("a/origin.jpg", 0);
    expect(describeRemix("proximity", [origin, gpsPhoto("a/metres.jpg", 3.6)])).toMatch(
      /^within \d+ m$/,
    );
    expect(describeRemix("proximity", [origin, gpsPhoto("a/decimal.jpg", 36)])).toMatch(
      /^within \d+\.\d km$/,
    );
    expect(describeRemix("proximity", [origin, gpsPhoto("a/rounded.jpg", 360)])).toMatch(
      /^within \d+ km$/,
    );
  });

  test("proximity ignores null photos, missing GPS, and shorter intermediate pairs", () => {
    const gpsPhoto = (path: string, latitudeSeconds: number): RandomPhotoRow => ({
      path,
      exif: [
        `GPS GPSLatitude: 0,0,${latitudeSeconds}`,
        "GPS GPSLatitudeRef: N",
        "GPS GPSLongitude: 0,0,0",
        "GPS GPSLongitudeRef: E",
      ].join("\n"),
      geocode: "",
    });
    expect(
      describeRemix("proximity", [
        null,
        makePhoto("a/no-gps.jpg"),
        gpsPhoto("a/0.jpg", 0),
        gpsPhoto("a/90.jpg", 90),
        gpsPhoto("a/45.jpg", 45),
      ]),
    ).toMatch(/^within /);
  });

  test("same-album returns the album folder name from the seed path", () => {
    expect(describeRemix("same-album", [makePhoto("data/albums/hokkaido/1.jpg")])).toBe("hokkaido");
  });

  test("same-city returns the city from the geocode line 2", () => {
    const seed: RandomPhotoRow = {
      path: "a/1.jpg",
      exif: "",
      geocode: makeGeocode("JP", "Sapporo", "Japan"),
    };
    expect(describeRemix("same-city", [seed])).toBe("Sapporo");
  });

  test("same-country returns the country line (last non-numeric)", () => {
    const seed: RandomPhotoRow = {
      path: "a/1.jpg",
      exif: "",
      geocode: makeGeocode("JP", "Sapporo", "Japan"),
    };
    expect(describeRemix("same-country", [seed])).toBe("Japan");
  });

  test("same-region returns the admin1 region (narrower than country)", () => {
    const seed: RandomPhotoRow = {
      path: "a/1.jpg",
      exif: "",
      geocode: makeGeocode("JP", "Sapporo", "Japan", "Hokkaido"),
    };
    expect(describeRemix("same-region", [seed])).toBe("Hokkaido");
  });

  test("same-region returns null when the geocode has no distinct admin1", () => {
    const seed: RandomPhotoRow = {
      path: "a/1.jpg",
      exif: "",
      // City-state-style geocode: no admin1 between city and country.
      geocode: makeGeocode("SG", "Outram Park", "Singapore"),
    };
    expect(describeRemix("same-region", [seed])).toBeNull();
  });

  test("same-year returns the seed's year", () => {
    expect(
      describeRemix("same-year", [
        makePhoto("a/1.jpg", new Date(2024, 5, 1)),
        makePhoto("a/2.jpg", new Date(2024, 8, 1)),
      ]),
    ).toBe("2024");
  });

  test("same-decade returns the year range across the slide", () => {
    expect(
      describeRemix("same-decade", [
        makePhoto("a/1.jpg", new Date(2021, 0, 1)),
        makePhoto("a/2.jpg", new Date(2024, 0, 1)),
      ]),
    ).toBe("2021–2024");
  });

  test("same-day-of-year returns the day plus distinct years", () => {
    const desc = describeRemix("same-day-of-year", [
      makePhoto("a/1.jpg", new Date(2024, 4, 27, 10, 0)),
      makePhoto("a/2.jpg", new Date(2021, 4, 27, 14, 0)),
      makePhoto("a/3.jpg", new Date(2018, 4, 27, 18, 0)),
    ]);
    expect(desc).toMatch(/27 May · 2018, 2021, 2024/);
  });

  test("anniversary returns just the distinct years", () => {
    expect(
      describeRemix("anniversary", [
        makePhoto("a/1.jpg", new Date(2024, 4, 27)),
        makePhoto("a/2.jpg", new Date(2021, 4, 25)),
      ]),
    ).toBe("2021, 2024");
  });

  test("golden-hour returns the local hours of each photo", () => {
    expect(
      describeRemix("golden-hour", [
        makePhoto("a/1.jpg", new Date(2024, 5, 1, 6, 42)),
        makePhoto("a/2.jpg", new Date(2024, 5, 1, 17, 58)),
      ]),
    ).toBe("06:42 · 17:58");
  });

  test("shared-camera returns the make+model from EXIF", () => {
    const seed: RandomPhotoRow = {
      path: "a/1.jpg",
      exif: "Image Make: FUJIFILM\nImage Model: X100V",
      geocode: "",
    };
    expect(describeRemix("shared-camera", [seed])).toBe("FUJIFILM X100V");
  });

  test("shared-camera strips redundant manufacturer prefixes", () => {
    // Some bodies report "Image Model: NIKON Z 7" with "Image Make: NIKON CORPORATION".
    // The display should not become "NIKON CORPORATION NIKON Z 7".
    const seed: RandomPhotoRow = {
      path: "a/1.jpg",
      exif: "Image Make: NIKON\nImage Model: NIKON Z 7",
      geocode: "",
    };
    expect(describeRemix("shared-camera", [seed])).toBe("NIKON Z 7");
  });

  test("descriptors return null when their required seed metadata is absent", () => {
    const empty = makePhoto("photo.jpg");
    expect(describeRemix("same-album", [])).toBeNull();
    expect(describeRemix("same-album", [empty])).toBeNull();
    expect(describeRemix("same-city", [])).toBeNull();
    expect(describeRemix("same-city", [{ ...empty, geocode: "1\n2\n3" }])).toBeNull();
    expect(describeRemix("same-region", [])).toBeNull();
    expect(describeRemix("same-country", [])).toBeNull();
    expect(describeRemix("same-country", [{ ...empty, geocode: "1\n2\n3" }])).toBeNull();
    expect(describeRemix("same-year", [null, empty])).toBeNull();
    expect(describeRemix("same-decade", [])).toBeNull();
    expect(describeRemix("same-day-of-year", [])).toBeNull();
    expect(describeRemix("anniversary", [])).toBeNull();
    expect(describeRemix("golden-hour", [])).toBeNull();
    expect(describeRemix("shared-camera", [])).toBeNull();
    expect(describeRemix("shared-camera", [empty])).toBeNull();
    expect(describeRemix("shared-camera", [{ ...empty, exif: "malformed" }])).toBeNull();
  });

  test("same-decade collapses a one-year slide to a single year", () => {
    expect(describeRemix("same-decade", [makePhoto("a/1.jpg", new Date(2024, 0, 1))])).toBe("2024");
  });

  test("shared-camera descriptors support make-only and model-only EXIF", () => {
    expect(
      describeRemix("shared-camera", [
        { ...makePhoto("a/1.jpg"), exif: "bad line\nImage Make: Leica" },
      ]),
    ).toBe("Leica");
    expect(
      describeRemix("shared-camera", [{ ...makePhoto("a/1.jpg"), exif: "Image Model: Q3" }]),
    ).toBe("Q3");
    expect(
      describeRemix("shared-camera", [
        { ...makePhoto("a/1.jpg"), exif: "EXIF ISO: 100\nImage Make: Leica" },
      ]),
    ).toBe("Leica");
  });

  test("returns null for strategies without a text descriptor", () => {
    const seed = makePhoto("a/1.jpg", new Date(2024, 0, 1));
    expect(describeRemix("dominant-colour", [seed])).toBeNull();
    expect(describeRemix("similar", [seed])).toBeNull();
    expect(describeRemix("juxtapose", [seed])).toBeNull();
    expect(describeRemix("random", [seed])).toBeNull();
  });
});

describe("getRemixSwatchRgb", () => {
  test("returns the seed's dominant palette colour for dominant-colour", () => {
    const seed: RandomPhotoRow = {
      path: "a/1.jpg",
      exif: "",
      geocode: "",
      colors: formatColors([
        [220, 30, 30],
        [40, 40, 40],
      ]),
    };
    expect(getRemixSwatchRgb("dominant-colour", [seed])).toEqual([220, 30, 30]);
  });

  test("returns null for any non-dominant-colour strategy", () => {
    const seed: RandomPhotoRow = {
      path: "a/1.jpg",
      exif: "",
      geocode: "",
      colors: formatColors([[220, 30, 30]]),
    };
    expect(getRemixSwatchRgb("same-album", [seed])).toBeNull();
    expect(getRemixSwatchRgb("proximity", [seed])).toBeNull();
  });

  test("returns null when the seed has no colours", () => {
    expect(getRemixSwatchRgb("dominant-colour", [makePhoto("a/1.jpg")])).toBeNull();
    expect(getRemixSwatchRgb("dominant-colour", [])).toBeNull();
    expect(
      getRemixSwatchRgb("dominant-colour", [{ ...makePhoto("a/1.jpg"), colors: "invalid" }]),
    ).toBeNull();
  });
});
