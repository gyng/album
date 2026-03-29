import { computePhotoStats } from "./computeStats";
import { Content, PhotoBlock } from "../services/types";

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

const makeAlbum = (photos: PhotoBlock[], name = "test-album"): Content => ({
  name,
  title: name,
  blocks: photos,
  formatting: {},
  _build: { slug: name, srcdir: `../albums/${name}` },
});

describe("computePhotoStats", () => {
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
    const stats = computePhotoStats([makeAlbum([
      makePhoto({ exif: { DateTimeOriginal: "2022:06:01 10:00:00" } }),
      makePhoto({ exif: { DateTimeOriginal: "2024:03:22 18:30:00" } }),
      makePhoto({ exif: {} }), // no date
    ])]);
    expect(stats.dateRange).toEqual([2022, 2024]);
  });

  it("dateRange is null when no photos have dates", () => {
    const stats = computePhotoStats([makeAlbum([makePhoto()])]);
    expect(stats.dateRange).toBeNull();
  });

  it("computes focal length 35mm coverage correctly", () => {
    const stats = computePhotoStats([makeAlbum([
      makePhoto({ exif: { FocalLengthIn35mmFormat: 35 } }),
      makePhoto({ exif: { FocalLengthIn35mmFormat: 85 } }),
      makePhoto({ exif: {} }), // missing
    ])]);

    const fl = stats.numericFacets.find((f) => f.facetId === "focal-length-35mm")!;
    expect(fl.coverage).toBeCloseTo(2 / 3);
    expect(fl.data.find((b) => b.label === "24–35mm")?.count).toBe(1);
    expect(fl.data.find((b) => b.label === "50–85mm")?.count).toBe(1);
    expect(fl.data.find((b) => b.label === "<24mm")?.count).toBe(0);
  });

  it("focal length 35mm does NOT count photos with only FocalLength", () => {
    const stats = computePhotoStats([makeAlbum([
      makePhoto({ exif: { FocalLength: 23 } }),
    ])]);
    const fl = stats.numericFacets.find((f) => f.facetId === "focal-length-35mm")!;
    expect(fl.coverage).toBe(0);
  });

  it("focal length actual does NOT count photos with only FocalLengthIn35mmFormat", () => {
    const stats = computePhotoStats([makeAlbum([
      makePhoto({ exif: { FocalLengthIn35mmFormat: 35 } }),
    ])]);
    const fl = stats.numericFacets.find((f) => f.facetId === "focal-length-actual")!;
    expect(fl.coverage).toBe(0);
  });

  it("computes camera counts correctly", () => {
    const stats = computePhotoStats([makeAlbum([
      makePhoto({ exif: { Make: "FUJIFILM", Model: "X-T5" } }),
      makePhoto({ exif: { Make: "FUJIFILM", Model: "X-T5" } }),
      makePhoto({ exif: { Make: "SONY", Model: "A7IV" } }),
      makePhoto({ exif: {} }),
    ])]);

    const cam = stats.stringFacets.find((f) => f.facetId === "camera")!;
    expect(cam.coverage).toBeCloseTo(3 / 4);
    expect(cam.data[0]).toEqual({ label: "FUJIFILM X-T5", count: 2 });
    expect(cam.data[1]).toEqual({ label: "SONY A7IV", count: 1 });
  });

  it("computes hour-of-day coverage (only counts photos with OffsetTime)", () => {
    const stats = computePhotoStats([makeAlbum([
      makePhoto({ exif: { DateTimeOriginal: "2024:03:22 17:45:00", OffsetTime: "+09:00" } }),
      makePhoto({ exif: { DateTimeOriginal: "2024:03:22 17:30:00", OffsetTime: "+09:00" } }),
      makePhoto({ exif: { DateTimeOriginal: "2024:03:22 09:00:00", OffsetTime: "+09:00" } }),
      makePhoto({ exif: {} }), // no offset — excluded
    ])]);

    const hour = stats.numericFacets.find((f) => f.facetId === "hour")!;
    expect(hour.coverage).toBeCloseTo(3 / 4);
    expect(hour.data.find((b) => b.label === "17:00")?.count).toBe(2);
    expect(hour.data.find((b) => b.label === "09:00")?.count).toBe(1);
    expect(hour.data.find((b) => b.label === "00:00")?.count).toBe(0);
  });

  it("top locations uses country from geocode", () => {
    const stats = computePhotoStats([makeAlbum([
      makePhoto({ tags: { geocode: "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan" } }),
      makePhoto({ tags: { geocode: "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan" } }),
      makePhoto({ tags: { geocode: "48.8566\n2.3522\nParis\nIle-de-France\nParis\nFR\nFrance" } }),
      makePhoto({ tags: null as any }),
    ])]);

    const loc = stats.stringFacets.find((f) => f.facetId === "location")!;
    expect(loc.coverage).toBeCloseTo(3 / 4);
    expect(loc.data[0]).toEqual({ label: "Japan", count: 2 });
    expect(loc.data[1]).toEqual({ label: "France", count: 1 });
  });
});
