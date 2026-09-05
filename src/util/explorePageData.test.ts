import type { PhotoStats } from "./computeStats";
import { packExploreStats, unpackExploreStats } from "./explorePageData";

it("round-trips detailed gear and colour ribbons without rounding or losing nulls", () => {
  const stats = {
    totalPhotos: 2,
    gear: {
      frames: [
        {
          year: "2024",
          position: 0.123456789,
          camera: "Camera",
          lens: null,
          band: null,
          src: "/a.jpg",
          href: "/album/a#one",
          label: "one",
          dateLabel: "Jan 1",
        },
        {
          year: "2024",
          position: 0.7654321,
          camera: "Camera",
          lens: "Lens",
          band: "wide",
          src: "/b.jpg",
          href: "/album/a#two",
          label: "two",
          dateLabel: "Jan 2",
        },
      ],
      bodies: [],
    },
    colorYearRibbons: [
      {
        label: "2024",
        total: 2,
        dominantFamily: null,
        slices: [
          {
            rgb: "rgb(1, 2, 3)",
            family: "blue",
            count: 1,
            position: 0.123456789,
            dateLabel: "Jan 1",
            thumbSrc: "/a.jpg",
            photoLabel: "one",
          },
        ],
      },
    ],
  } as unknown as PhotoStats;
  const packed = packExploreStats(stats);
  expect(unpackExploreStats(JSON.parse(JSON.stringify(packed)))).toEqual(stats);
  expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(stats).length);
});
