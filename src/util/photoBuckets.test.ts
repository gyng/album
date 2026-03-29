import {
  FOCAL_LENGTH_35MM_FACET,
  FOCAL_LENGTH_ACTUAL_FACET,
  APERTURE_FACET,
  ISO_FACET,
  HOUR_FACET,
  CAMERA_FACET,
  LENS_FACET,
  LOCATION_FACET,
} from "./photoBuckets";
import { Exif, Tags } from "../services/types";

const exif = (overrides: Partial<Exif> = {}): Exif => ({
  DateTimeOriginal: "2024:03:22 18:30:00",
  ...overrides,
});

const tags = (overrides: Partial<Tags> = {}): Tags => ({ ...overrides });

// ─── Focal length 35mm ─────────────────────────────────────────────────────

describe("FOCAL_LENGTH_35MM_FACET", () => {
  it("extracts FocalLengthIn35mmFormat", () => {
    expect(FOCAL_LENGTH_35MM_FACET.extract(exif({ FocalLengthIn35mmFormat: 35 }))).toBe(35);
  });

  it("returns null when field is absent", () => {
    expect(FOCAL_LENGTH_35MM_FACET.extract(exif())).toBeNull();
  });

  it("does NOT fall back to FocalLength", () => {
    expect(FOCAL_LENGTH_35MM_FACET.extract(exif({ FocalLength: 23 }))).toBeNull();
  });

  it("buckets correctly", () => {
    expect(FOCAL_LENGTH_35MM_FACET.buckets.find((b) => b.match(23))?.label).toBe("<24mm");
    expect(FOCAL_LENGTH_35MM_FACET.buckets.find((b) => b.match(24))?.label).toBe("24–35mm");
    expect(FOCAL_LENGTH_35MM_FACET.buckets.find((b) => b.match(35))?.label).toBe("24–35mm");
    expect(FOCAL_LENGTH_35MM_FACET.buckets.find((b) => b.match(50))?.label).toBe("35–50mm");
    expect(FOCAL_LENGTH_35MM_FACET.buckets.find((b) => b.match(85))?.label).toBe("50–85mm");
    expect(FOCAL_LENGTH_35MM_FACET.buckets.find((b) => b.match(135))?.label).toBe("85–135mm");
    expect(FOCAL_LENGTH_35MM_FACET.buckets.find((b) => b.match(200))?.label).toBe("135mm+");
  });

  it("every value falls into exactly one bucket", () => {
    for (const v of [10, 23, 24, 35, 36, 50, 51, 85, 86, 135, 136, 400]) {
      const matches = FOCAL_LENGTH_35MM_FACET.buckets.filter((b) => b.match(v));
      expect(matches).toHaveLength(1);
    }
  });
});

// ─── Focal length actual ───────────────────────────────────────────────────

describe("FOCAL_LENGTH_ACTUAL_FACET", () => {
  it("extracts FocalLength", () => {
    expect(FOCAL_LENGTH_ACTUAL_FACET.extract(exif({ FocalLength: 23 }))).toBe(23);
  });

  it("returns null when field is absent", () => {
    expect(FOCAL_LENGTH_ACTUAL_FACET.extract(exif())).toBeNull();
  });

  it("does NOT fall back to FocalLengthIn35mmFormat", () => {
    expect(FOCAL_LENGTH_ACTUAL_FACET.extract(exif({ FocalLengthIn35mmFormat: 35 }))).toBeNull();
  });

  it("buckets correctly", () => {
    expect(FOCAL_LENGTH_ACTUAL_FACET.buckets.find((b) => b.match(10))?.label).toBe("<18mm");
    expect(FOCAL_LENGTH_ACTUAL_FACET.buckets.find((b) => b.match(18))?.label).toBe("18–23mm");
    expect(FOCAL_LENGTH_ACTUAL_FACET.buckets.find((b) => b.match(23))?.label).toBe("18–23mm");
    expect(FOCAL_LENGTH_ACTUAL_FACET.buckets.find((b) => b.match(35))?.label).toBe("23–35mm");
    expect(FOCAL_LENGTH_ACTUAL_FACET.buckets.find((b) => b.match(56))?.label).toBe("35–56mm");
    expect(FOCAL_LENGTH_ACTUAL_FACET.buckets.find((b) => b.match(100))?.label).toBe("56–100mm");
    expect(FOCAL_LENGTH_ACTUAL_FACET.buckets.find((b) => b.match(200))?.label).toBe("100mm+");
  });

  it("every value falls into exactly one bucket", () => {
    for (const v of [1, 17, 18, 23, 24, 35, 36, 56, 57, 100, 101, 300]) {
      const matches = FOCAL_LENGTH_ACTUAL_FACET.buckets.filter((b) => b.match(v));
      expect(matches).toHaveLength(1);
    }
  });
});

// ─── Aperture ──────────────────────────────────────────────────────────────

describe("APERTURE_FACET", () => {
  it("extracts FNumber", () => {
    expect(APERTURE_FACET.extract(exif({ FNumber: 2 }))).toBe(2);
  });

  it("buckets correctly", () => {
    expect(APERTURE_FACET.buckets.find((b) => b.match(1.4))?.label).toBe("f/1.0–1.8");
    expect(APERTURE_FACET.buckets.find((b) => b.match(1.8))?.label).toBe("f/1.0–1.8");
    expect(APERTURE_FACET.buckets.find((b) => b.match(2.0))?.label).toBe("f/2–2.8");
    expect(APERTURE_FACET.buckets.find((b) => b.match(2.8))?.label).toBe("f/2–2.8");
    expect(APERTURE_FACET.buckets.find((b) => b.match(4))?.label).toBe("f/3.5–5.6");
    expect(APERTURE_FACET.buckets.find((b) => b.match(8))?.label).toBe("f/8–11");
    expect(APERTURE_FACET.buckets.find((b) => b.match(16))?.label).toBe("f/16+");
  });

  it("every value falls into exactly one bucket", () => {
    for (const v of [1.0, 1.4, 1.8, 2.0, 2.8, 3.5, 4.0, 5.6, 8, 11, 16, 22]) {
      const matches = APERTURE_FACET.buckets.filter((b) => b.match(v));
      expect(matches).toHaveLength(1);
    }
  });
});

// ─── ISO ───────────────────────────────────────────────────────────────────

describe("ISO_FACET", () => {
  it("buckets correctly", () => {
    expect(ISO_FACET.buckets.find((b) => b.match(100))?.label).toBe("≤200");
    expect(ISO_FACET.buckets.find((b) => b.match(200))?.label).toBe("≤200");
    expect(ISO_FACET.buckets.find((b) => b.match(400))?.label).toBe("400");
    expect(ISO_FACET.buckets.find((b) => b.match(800))?.label).toBe("800");
    expect(ISO_FACET.buckets.find((b) => b.match(1600))?.label).toBe("1600");
    expect(ISO_FACET.buckets.find((b) => b.match(3200))?.label).toBe("3200");
    expect(ISO_FACET.buckets.find((b) => b.match(6400))?.label).toBe("6400+");
    expect(ISO_FACET.buckets.find((b) => b.match(12800))?.label).toBe("6400+");
  });

  it("every value falls into exactly one bucket", () => {
    for (const v of [100, 200, 201, 400, 401, 800, 801, 1600, 1601, 3200, 3201, 6400]) {
      const matches = ISO_FACET.buckets.filter((b) => b.match(v));
      expect(matches).toHaveLength(1);
    }
  });
});

// ─── Hour ──────────────────────────────────────────────────────────────────

describe("HOUR_FACET", () => {
  it("extracts local hour from native EXIF format (camera-local, no conversion needed)", () => {
    // EXIF "YYYY:MM:DD HH:MM:SS" — not a UTC ISO string, hour is already local
    expect(HOUR_FACET.extract(exif({ DateTimeOriginal: "2024:03:22 17:45:00", OffsetTime: "+09:00" }))).toBe(17);
    expect(HOUR_FACET.extract(exif({ DateTimeOriginal: "2024:03:22 00:00:00", OffsetTime: "+00:00" }))).toBe(0);
  });

  it("recovers local hour from UTC ISO string produced by exifr reviveValues", () => {
    // exifr converts 15:35 JST (+09:00) → "2026-02-21T06:35:19.000Z"
    // We must add +9 back to get 15
    expect(HOUR_FACET.extract(exif({ DateTimeOriginal: "2026-02-21T06:35:19.000Z", OffsetTime: "+09:00" }))).toBe(15);
  });

  it("handles offset crossing midnight forward", () => {
    // 23:00 UTC + 9h = 08:00 next day local
    expect(HOUR_FACET.extract(exif({ DateTimeOriginal: "2026-02-21T23:00:00.000Z", OffsetTime: "+09:00" }))).toBe(8);
  });

  it("handles negative offset", () => {
    // 02:00 UTC - 5h = 21:00 previous day local
    expect(HOUR_FACET.extract(exif({ DateTimeOriginal: "2026-02-21T02:00:00.000Z", OffsetTime: "-05:00" }))).toBe(21);
  });

  it("returns null when OffsetTime is absent (camera clock may be UTC)", () => {
    expect(HOUR_FACET.extract(exif({ DateTimeOriginal: "2024:03:22 17:45:00" }))).toBeNull();
  });

  it("returns null when DateTimeOriginal is absent", () => {
    expect(HOUR_FACET.extract({ OffsetTime: "+09:00" })).toBeNull();
  });

  it("has 24 buckets", () => {
    expect(HOUR_FACET.buckets).toHaveLength(24);
  });

  it("each hour maps to exactly one bucket", () => {
    for (let h = 0; h < 24; h++) {
      const matches = HOUR_FACET.buckets.filter((b) => b.match(h));
      expect(matches).toHaveLength(1);
      expect(matches[0]?.label).toBe(`${String(h).padStart(2, "0")}:00`);
    }
  });
});

// ─── Camera ────────────────────────────────────────────────────────────────

describe("CAMERA_FACET", () => {
  it("combines Make + Model", () => {
    expect(CAMERA_FACET.extract(exif({ Make: "FUJIFILM", Model: "X-T5" }))).toBe("FUJIFILM X-T5");
  });

  it("avoids doubling brand when Model starts with Make", () => {
    expect(CAMERA_FACET.extract(exif({ Make: "FUJIFILM", Model: "FUJIFILM X-T5" }))).toBe("FUJIFILM X-T5");
  });

  it("returns just Model when Make is absent", () => {
    expect(CAMERA_FACET.extract(exif({ Model: "iPhone 15 Pro" }))).toBe("iPhone 15 Pro");
  });

  it("returns null when both are absent", () => {
    expect(CAMERA_FACET.extract(exif())).toBeNull();
  });
});

// ─── Lens ──────────────────────────────────────────────────────────────────

describe("LENS_FACET", () => {
  it("extracts LensModel", () => {
    expect(LENS_FACET.extract(exif({ LensModel: "XF23mmF2 R WR" }))).toBe("XF23mmF2 R WR");
  });

  it("returns null when absent", () => {
    expect(LENS_FACET.extract(exif())).toBeNull();
  });
});

// ─── Location ──────────────────────────────────────────────────────────────

describe("LOCATION_FACET", () => {
  it("extracts country from geocode in tags", () => {
    const t = tags({ geocode: "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan" });
    expect(LOCATION_FACET.extract(exif(), t)).toBe("Japan");
  });

  it("returns null when no geocode", () => {
    expect(LOCATION_FACET.extract(exif(), tags())).toBeNull();
    expect(LOCATION_FACET.extract(exif())).toBeNull();
  });
});
