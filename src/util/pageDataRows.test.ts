import type { MapWorldEntry } from "../components/MapWorld";
import type { TimelineEntry } from "../components/timelineTypes";
import {
  packMapWorldEntry,
  packTimelineEntry,
  unpackMapWorldEntry,
  unpackTimelineEntry,
} from "./pageDataRows";

describe("compact page-data rows", () => {
  it("round-trips map entries while using optimised image dimensions for placeholders", () => {
    const entry: MapWorldEntry = {
      album: "trip",
      src: { src: "/trip/photo@800.avif", width: 800, height: 533 },
      decLat: 1.25,
      decLng: 103.8,
      date: "2026-07-04T18:37:35",
      href: "/album/trip#photo.jpg",
      placeholderColor: "rgba(1, 2, 3, 1)",
      placeholderWidth: 7728,
      placeholderHeight: 5152,
    };

    const row = packMapWorldEntry(entry);

    expect(Array.isArray(row)).toBe(true);
    expect(unpackMapWorldEntry(row)).toEqual({
      ...entry,
      placeholderWidth: 800,
      placeholderHeight: 533,
    });
  });

  it("round-trips timeline entries and stores only the displayed geocode summary", () => {
    const entry: TimelineEntry = {
      album: "trip",
      date: "2026-07-04",
      dateTimeOriginal: "2026-07-04T18:37:35",
      decLat: 35.6,
      decLng: 139.7,
      geocode: "JP\nAkihabara\n35.6\n139.7\nTokyo\nChiyoda-ku\nJapan",
      src: { src: "/trip/photo@800.avif", width: 800, height: 533 },
      href: "/album/trip#photo.jpg",
      path: "/albums/trip/photo.jpg",
      placeholderColor: "rgba(1, 2, 3, 1)",
      placeholderWidth: 7728,
      placeholderHeight: 5152,
    };

    const row = packTimelineEntry(entry);

    expect(Array.isArray(row)).toBe(true);
    expect(unpackTimelineEntry(row)).toEqual({
      ...entry,
      geocode: "Akihabara, Chiyoda-ku, Japan",
      placeholderWidth: 800,
      placeholderHeight: 533,
    });
  });
});
