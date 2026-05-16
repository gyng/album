import { RandomPhotoRow } from "../components/search/api";
import {
  decideRemixCompanionCount,
  getTimeAffinityScore,
  pickRemixCompanions,
  timeAwareShufflePhotos,
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

describe("getTimeAffinityScore", () => {
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
    expect(getTimeAffinityScore(summer, now)).toBeGreaterThan(
      getTimeAffinityScore(winter, now),
    );
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
    const earlyMorning = new Date(2026, 5, 10, 0, 30); // 1h cyclic away
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
    expect(getTimeAffinityScore(dec, janNow)).toBeGreaterThan(
      getTimeAffinityScore(jul, janNow),
    );
  });
});

describe("timeAwareShufflePhotos", () => {
  test("returns the same set of photos", () => {
    const photos = [
      makePhoto("data/albums/a/p1.jpg", new Date(2024, 0, 1, 9)),
      makePhoto("data/albums/a/p2.jpg", new Date(2024, 5, 1, 14)),
      makePhoto("data/albums/a/p3.jpg", new Date(2024, 9, 1, 19)),
    ];
    const out = timeAwareShufflePhotos(photos, new Date(2026, 5, 1, 14));
    expect(new Set(out.map((p) => p.path))).toEqual(
      new Set(photos.map((p) => p.path)),
    );
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
      offBand.push(
        makePhoto(`data/albums/winter/${i}.jpg`, new Date(2024, 0, 1, 3, 0)),
      );
    }
    const onBand: RandomPhotoRow[] = [];
    for (let i = 0; i < 5; i += 1) {
      onBand.push(
        makePhoto(`data/albums/summer/${i}.jpg`, new Date(2024, 6, 10, 14, 0)),
      );
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

describe("decideRemixCompanionCount", () => {
  test("returns 0 when first random draw exceeds probability", () => {
    expect(decideRemixCompanionCount(0.03, () => 0.5)).toBe(0);
    expect(decideRemixCompanionCount(0.03, () => 0.03)).toBe(0);
  });

  test("returns 1 (2-up) when below probability and second draw < 0.7", () => {
    const random = jest
      .fn()
      .mockReturnValueOnce(0.01) // pass remix probability
      .mockReturnValueOnce(0.5); // 2-up branch
    expect(decideRemixCompanionCount(0.03, random)).toBe(1);
  });

  test("returns 2 (3-up) when below probability and second draw >= 0.7", () => {
    const random = jest
      .fn()
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.85);
    expect(decideRemixCompanionCount(0.03, random)).toBe(2);
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
    const pick = pickRemixCompanions(
      seed,
      [...sameAlbumPool, ...otherAlbumPool],
      2,
      random,
    );
    expect(pick.strategy).toBe("same-album");
    for (const photo of pick.companions) {
      expect(photo.path.startsWith("data/albums/japan/")).toBe(true);
    }
  });

  test("falls through to a later strategy when the rolled one has too few candidates", () => {
    // Rig strategy roll to land on `same-year` (0.28 + something). With our
    // photos lacking EXIF dates, `same-year` returns [], so we fall through
    // to the next strategy in priority order.
    const random = jest
      .fn()
      .mockReturnValueOnce(0.4) // lands in same-year band (after same-album=0.28)
      .mockReturnValue(0.5);
    const pick = pickRemixCompanions(
      seed,
      [...sameAlbumPool, ...otherAlbumPool],
      2,
      random,
    );
    // None of our photos have EXIF, so same-year/same-time-of-day/same-region
    // all return empty. Falls through to same-album (or another that hits).
    expect(pick.companions).toHaveLength(2);
    expect(pick.strategy).not.toBe("same-year");
  });

  test("returns no duplicates", () => {
    const pick = pickRemixCompanions(
      seed,
      [...sameAlbumPool, ...otherAlbumPool],
      2,
    );
    expect(new Set(pick.companions.map((p) => p.path)).size).toBe(
      pick.companions.length,
    );
  });

  test("juxtapose strategy only picks from different albums and regions", () => {
    const tokyo = makePhoto("data/albums/japan/seed.jpg");
    tokyo.geocode = "Shibuya\nTokyo\nJapan";
    const japanCompanion = makePhoto("data/albums/japan/2.jpg");
    japanCompanion.geocode = "Kyoto\nKyoto\nJapan";
    const icelandCompanion = makePhoto("data/albums/iceland/x.jpg");
    icelandCompanion.geocode = "Reykjavik\nReykjavik\nIceland";

    // Force juxtapose by rigging the roll into the juxtapose band.
    // Cumulative through prior strategies: 0.22+0.12+0.14+0.10+0.08+0.08+
    // 0.06+0.06 = 0.86; juxtapose adds 0.08 → [0.86, 0.94].
    const random = jest
      .fn()
      .mockReturnValueOnce(0.88) // juxtapose band
      .mockReturnValue(0.5);
    const pick = pickRemixCompanions(
      tokyo,
      [japanCompanion, icelandCompanion, icelandCompanion],
      1,
      random,
    );
    expect(pick.strategy).toBe("juxtapose");
    expect(pick.companions[0]?.path.startsWith("data/albums/iceland/")).toBe(
      true,
    );
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

    // Force proximity by landing the weighted roll in [0.58, 0.66).
    const random = jest
      .fn()
      .mockReturnValueOnce(0.6)
      .mockReturnValue(0.5);
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

  test("similar strategy is a placeholder that falls through to other strategies", () => {
    // Cumulative weights: same-album 0.28, same-year 0.46, same-region 0.64,
    // same-time-of-day 0.78, juxtapose 0.9, random 1.0. There's no `similar`
    // band, so it can only be reached via the iteration order — and since
    // its filter returns [], it should never be the *chosen* strategy.
    for (let i = 0; i < 50; i += 1) {
      const pick = pickRemixCompanions(
        seed,
        [...sameAlbumPool, ...otherAlbumPool],
        1,
      );
      expect(pick.strategy).not.toBe("similar");
    }
  });
});
