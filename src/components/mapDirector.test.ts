import type { MapWorldEntry } from "./MapWorld";
import { buildMapDirectorSequence } from "./mapDirector";

const photo = (overrides: Partial<MapWorldEntry>): MapWorldEntry => ({
  album: "one",
  src: { src: "/photo.jpg", width: 100, height: 100 },
  decLat: 35,
  decLng: 139,
  date: "2024-01-01T00:00:00",
  href: "/one.jpg",
  ...overrides,
});

describe("buildMapDirectorSequence", () => {
  it("starts with the newest frame then favours a meaningfully different place", () => {
    const newest = photo({ href: "newest", date: "2025-01-01T00:00:00" });
    const nearby = photo({ href: "nearby", decLat: 35.01, decLng: 139.01 });
    const far = photo({ href: "far", album: "two", decLat: 51.5, decLng: -0.1 });

    const sequence = buildMapDirectorSequence([nearby, far, newest]);

    expect(sequence[0]?.href).toBe("newest");
    expect(sequence[1]?.href).toBe("far");
    expect(new Set(sequence.map(({ href }) => href)).size).toBe(3);
  });

  it("drops unlocated photos and respects its maximum sequence length", () => {
    const photos = Array.from({ length: 30 }, (_, index) =>
      photo({ href: `photo-${index}`, decLat: index, decLng: index }),
    );
    photos.push(photo({ href: "missing", decLat: null, decLng: null }));

    const sequence = buildMapDirectorSequence(photos, 8);

    expect(sequence).toHaveLength(8);
    expect(sequence.some(({ href }) => href === "missing")).toBe(false);
  });
});
