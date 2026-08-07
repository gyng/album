import type { Content, PhotoBlock } from "../services/types";
import { computeGearStats } from "./computeGearStats";

type PhotoSpec = {
  camera?: string;
  lens?: string;
  focal35?: number;
  focal?: number;
  aperture?: number;
  iso?: number;
  taken?: string;
  place?: string;
};

const photo = (id: string, spec: PhotoSpec): PhotoBlock =>
  ({
    kind: "photo",
    id,
    data: { src: `/photos/${id}.jpg` },
    _build: {
      srcset: [{ src: `/photos/${id}@800.avif`, width: 800 }],
      exif: {
        ...(spec.camera === undefined ? {} : { Make: "FUJIFILM", Model: spec.camera }),
        ...(spec.lens === undefined ? {} : { LensModel: spec.lens }),
        ...(spec.focal35 === undefined ? {} : { FocalLengthIn35mmFormat: spec.focal35 }),
        ...(spec.focal === undefined ? {} : { FocalLength: spec.focal }),
        ...(spec.aperture === undefined ? {} : { FNumber: spec.aperture }),
        ...(spec.iso === undefined ? {} : { ISO: spec.iso }),
        DateTimeOriginal: spec.taken ?? "2024-05-04T13:00:00",
      },
      tags: {
        path: `../albums/test/${id}.jpg`,
        ...(spec.place === undefined ? {} : { geocode: `${spec.place}\nJapan` }),
      },
    },
  }) as unknown as PhotoBlock;

const album = (blocks: PhotoBlock[]): Content =>
  ({ _build: { slug: "test" }, blocks }) as unknown as Content;

describe("computeGearStats", () => {
  // A body's years are the whole point of the timeline: one camera hands over
  // to the next, and counting the archive as a lump cannot show it.
  it("splits each year between the cameras that shot it", () => {
    const stats = computeGearStats([
      album([
        photo("a", { camera: "X100T", taken: "2023-01-02T10:00:00" }),
        photo("b", { camera: "X100T", taken: "2023-06-02T10:00:00" }),
        photo("c", { camera: "X100T", taken: "2024-01-02T10:00:00" }),
        photo("d", { camera: "X-T5", taken: "2024-02-02T10:00:00" }),
        photo("e", { camera: "X-T5", taken: "2024-03-02T10:00:00" }),
        photo("f", { camera: "X-T5", taken: "2024-04-02T10:00:00" }),
      ]),
    ]);

    expect(stats.cameraYears.map((year) => ({ ...year, frames: year.frames.length }))).toEqual([
      {
        label: "2023",
        total: 2,
        cameras: [{ camera: "FUJIFILM X100T", count: 2, share: 100 }],
        frames: 2,
      },
      {
        label: "2024",
        total: 4,
        cameras: [
          { camera: "FUJIFILM X-T5", count: 3, share: 75 },
          { camera: "FUJIFILM X100T", count: 1, share: 25 },
        ],
        frames: 4,
      },
    ]);
  });

  // A stacked bar says a year was two thirds one body; only the frames say the
  // handover happened in June.
  it("places every frame where it falls in its year", () => {
    const stats = computeGearStats([
      album([
        photo("a", { camera: "X100T", taken: "2024-01-01T00:00:00" }),
        photo("b", { camera: "X-T5", taken: "2024-07-01T12:00:00" }),
        photo("c", { camera: "X-T5", taken: "2024-12-31T00:00:00" }),
      ]),
    ]);

    const frames = stats.cameraYears[0]?.frames;

    expect(frames?.map((frame) => frame.camera)).toEqual([
      "FUJIFILM X100T",
      "FUJIFILM X-T5",
      "FUJIFILM X-T5",
    ]);
    expect(frames?.[0]?.position).toBeCloseTo(0, 5);
    expect(frames?.[1]?.position).toBeCloseTo(0.5, 2);
    expect(frames?.[2]?.position).toBeCloseTo(1, 2);
  });

  it("leaves out a photograph with no date, rather than inventing a year for it", () => {
    const stats = computeGearStats([
      album([
        photo("a", { camera: "X100T", taken: "2023-01-02T10:00:00" }),
        { ...photo("b", { camera: "X100T" }), _build: { exif: {}, srcset: [], tags: {} } } as never,
      ]),
    ]);

    expect(stats.cameraYears.map((year) => year.total)).toEqual([1]);
  });

  describe("a body's own signature", () => {
    const stats = () =>
      computeGearStats([
        album([
          photo("a", {
            camera: "X100T",
            lens: "23mm",
            focal35: 35,
            aperture: 2,
            iso: 400,
            taken: "2024-05-04T21:00:00",
            place: "Tokyo",
          }),
          photo("b", {
            camera: "X100T",
            lens: "23mm",
            focal35: 35,
            aperture: 2.8,
            iso: 800,
            taken: "2024-05-04T22:00:00",
            place: "Tokyo",
          }),
          photo("c", {
            camera: "X100T",
            lens: "23mm",
            focal35: 35,
            aperture: 5.6,
            iso: 1600,
            taken: "2024-05-04T23:00:00",
            place: "Osaka",
          }),
          photo("d", { camera: "X-T5", focal35: 80, aperture: 4, iso: 200, place: "Tokyo" }),
        ]),
      ]);

    it("reports the middle of what a body was set to, not its extremes", () => {
      const x100t = stats().cameraProfiles.find((profile) => profile.camera === "FUJIFILM X100T")!;

      expect(x100t.count).toBe(3);
      expect(x100t.focalLength).toEqual({ mm: 35, equivalent: true });
      expect(x100t.aperture).toBe(2.8);
      expect(x100t.iso).toBe(800);
    });

    // A median hour reads as noon for a camera used at 23:00 and 01:00, so the
    // busiest stretch is found around the clock instead.
    it("finds the stretch of the day a body is carried, across midnight", () => {
      const x100t = stats().cameraProfiles.find((profile) => profile.camera === "FUJIFILM X100T")!;

      expect(x100t.busiestHours).toEqual({ from: 20, to: 23 });
    });

    it("names what it is usually paired with and where it usually is", () => {
      const x100t = stats().cameraProfiles.find((profile) => profile.camera === "FUJIFILM X100T")!;

      expect(x100t.topLens).toEqual({ label: "23mm", share: 100 });
      expect(x100t.topPlace).toEqual({ label: "Tokyo, Japan", share: 67 });
      expect(x100t.years).toEqual([2024, 2024]);
    });

    it("orders bodies by how much they were used", () => {
      expect(stats().cameraProfiles.map((profile) => profile.camera)).toEqual([
        "FUJIFILM X100T",
        "FUJIFILM X-T5",
      ]);
    });

    // A phone writes a zero rather than leaving the tag out, and "0mm" is worse
    // than nothing: it reads as a measurement.
    it("treats a zero reading as no reading", () => {
      const stats = computeGearStats([
        album([
          photo("a", { camera: "Nexus", focal: 0, aperture: 0, iso: 0 }),
          photo("b", { camera: "Nexus", focal: 0, aperture: 0, iso: 0 }),
        ]),
      ]);

      expect(stats.cameraProfiles[0]).toMatchObject({
        focalLength: null,
        aperture: null,
        iso: null,
      });
    });

    it("says nothing about settings a body never recorded", () => {
      const stats = computeGearStats([album([photo("a", { camera: "X100T" })])]);

      expect(stats.cameraProfiles[0]).toMatchObject({
        focalLength: null,
        aperture: null,
        iso: null,
        topLens: null,
        topPlace: null,
      });
    });
  });

  describe("where a zoom is actually used", () => {
    it("spreads a zoom's frames across its own range", () => {
      const frames = [
        ...Array.from({ length: 8 }, () => 12),
        ...Array.from({ length: 8 }, () => 80),
      ];
      const stats = computeGearStats([
        album(
          frames.map((mm, index) =>
            photo(`z${index}`, { camera: "X-T5", lens: "XF16-80mm", focal: mm }),
          ),
        ),
      ]);

      const zoom = stats.lensFocalRanges.find((lens) => lens.lens === "XF16-80mm")!;

      expect([zoom.shortest, zoom.longest]).toEqual([12, 80]);
      expect(zoom.buckets).toHaveLength(12);
      expect(zoom.buckets[0]?.count).toBe(8);
      expect(zoom.buckets.at(-1)?.count).toBe(8);
      // The hole in the middle is the point: a zoom used at both ends only.
      expect(zoom.buckets.slice(1, 11).every((bucket) => bucket.count === 0)).toBe(true);
      expect(zoom.count).toBe(16);
    });

    // The chart's height is relative, so the axis has to say what the tallest
    // bin actually is.
    it("names its busiest bin", () => {
      const frames = [...Array.from({ length: 12 }, () => 80), 12, 12, 12, 12];
      const stats = computeGearStats([
        album(
          frames.map((mm, index) =>
            photo(`p${index}`, { camera: "X-T5", lens: "XF16-80mm", focal: mm }),
          ),
        ),
      ]);

      expect(stats.lensFocalRanges[0]?.peak).toMatchObject({ from: 74, to: 80, count: 12 });
    });

    it("follows a zoom's use from year to year against its whole range", () => {
      const early = Array.from({ length: 8 }, () => ({ mm: 16, year: "2023" }));
      const late = Array.from({ length: 8 }, () => ({ mm: 80, year: "2024" }));
      const stats = computeGearStats([
        album(
          [...early, ...late].map((frame, index) =>
            photo(`p${index}`, {
              camera: "X-T5",
              lens: "XF16-80mm",
              focal: frame.mm,
              taken: `${frame.year}-05-04T13:00:00`,
            }),
          ),
        ),
      ]);

      const years = stats.lensFocalRanges[0]?.years;

      expect(years?.map((year) => year.label)).toEqual(["2023", "2024"]);
      // Each year is banded against 16–80mm, not against its own frames, or
      // both years would fill their bar and the move would vanish.
      expect(years?.[0]?.bands.map((band) => band.count)).toEqual([8, 0, 0, 0]);
      expect(years?.[1]?.bands.map((band) => band.count)).toEqual([0, 0, 0, 8]);
    });

    // A prime has one focal length, so a distribution over it says nothing at
    // all — and dividing by a zero-wide range is how it would say it.
    it("leaves a prime out", () => {
      const stats = computeGearStats([
        album([
          photo("a", { camera: "X100T", lens: "23mm", focal: 23 }),
          photo("b", { camera: "X100T", lens: "23mm", focal: 23 }),
          photo("c", { camera: "X100T", lens: "23mm", focal: 23 }),
        ]),
      ]);

      expect(stats.lensFocalRanges).toEqual([]);
    });
  });

  it("has nothing to say about an archive with no EXIF at all", () => {
    const stats = computeGearStats([album([photo("a", {})])]);

    expect(stats).toEqual({ cameraYears: [], cameraProfiles: [], lensFocalRanges: [] });
  });
});
