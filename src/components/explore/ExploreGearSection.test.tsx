/**
 * @jest-environment jsdom
 */

import { render, screen, within } from "@testing-library/react";
import type { GearStats } from "../../util/computeGearStats";
import { ExploreGearSection } from "./ExploreGearSection";

const gear = (overrides: Partial<GearStats> = {}): GearStats => ({
  cameraYears: [
    { label: "2023", total: 4, cameras: [{ camera: "X100T", count: 4, share: 100 }] },
    {
      label: "2024",
      total: 4,
      cameras: [
        { camera: "X-T5", count: 3, share: 75 },
        { camera: "X100T", count: 1, share: 25 },
      ],
    },
  ],
  cameraProfiles: [
    {
      camera: "X100T",
      count: 5,
      share: 62,
      years: [2023, 2024],
      focalLength: { mm: 35, equivalent: true },
      aperture: 2.8,
      iso: 400,
      busiestHours: { from: 21, to: 0 },
      topLens: { label: "23mm", share: 90 },
      topPlace: { label: "Kyoto, Japan", share: 40 },
    },
    {
      camera: "GT-I9300",
      count: 3,
      share: 38,
      years: null,
      focalLength: null,
      aperture: null,
      iso: null,
      busiestHours: null,
      topLens: null,
      topPlace: null,
    },
  ],
  lensFocalRanges: [
    {
      lens: "XF16-80mm",
      count: 16,
      shortest: 16,
      longest: 80,
      buckets: [
        { from: 16, to: 48, count: 12, share: 75 },
        { from: 48, to: 80, count: 4, share: 25 },
      ],
    },
  ],
  ...overrides,
});

const frames = [
  {
    camera: "X100T",
    photo: {
      path: "../albums/kyoto/a.jpg",
      src: "/a.avif",
      href: "/album/kyoto#a.jpg",
      label: "A lane at night",
    },
    count: 5,
    centroidSimilarityPercent: 88,
  },
];

describe("the gear section's own reporting", () => {
  it("gives a body its settings, its company and its own frame", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);

    const card = screen.getByRole("link", { name: "X100T" }).closest("div")!.parentElement!;
    const traits = within(card);
    expect(traits.getByText("35mm")).toBeInTheDocument();
    expect(traits.getByText("f/2.8")).toBeInTheDocument();
    expect(traits.getByText("400")).toBeInTheDocument();
    // The busiest stretch is four hours long and may run past midnight.
    expect(traits.getByText("21:00–01:00")).toBeInTheDocument();
    expect(traits.getByText("23mm · 90%")).toBeInTheDocument();
    expect(traits.getByText("Kyoto, Japan · 40%")).toBeInTheDocument();
    expect(traits.getByRole("img", { name: "A lane at night" })).toBeInTheDocument();
  });

  // A phone that never wrote a lens or an aperture should leave those rows out
  // rather than printing "null" or an empty row.
  it("says nothing about settings a body never recorded", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);

    const card = screen.getByRole("link", { name: "GT-I9300" }).closest("div")!.parentElement!;
    expect(within(card).queryByText(/f\//)).not.toBeInTheDocument();
    expect(within(card).queryAllByRole("img")).toHaveLength(0);
  });

  it("divides each year between the bodies that shot it, and links each share", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);

    const shares = screen.getAllByTitle(/in 2024:/).map((segment) => segment.getAttribute("title"));

    expect(shares).toEqual(["X-T5 in 2024: 3 photos, 75%", "X100T in 2024: 1 photo, 25%"]);
  });

  // One year is a bar, not a history — the timeline only earns its place once
  // there is a handover to see.
  it("keeps the timeline back until there is more than one year", () => {
    render(
      <ExploreGearSection
        gear={gear({
          cameraYears: [
            { label: "2024", total: 4, cameras: [{ camera: "X100T", count: 4, share: 100 }] },
          ],
        })}
        frames={[]}
      />,
    );

    expect(screen.queryByText("Bodies over time")).not.toBeInTheDocument();
  });

  it("shows where along its own range a zoom is used", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);

    expect(screen.getByText(/16–80mm/)).toBeInTheDocument();
    expect(screen.getByTitle("16–48mm: 12 photos, 75%")).toBeInTheDocument();
    expect(screen.getByTitle("48–80mm: 4 photos, 25%")).toBeInTheDocument();
  });

  it("renders nothing at all when no photograph names its camera", () => {
    const { container } = render(
      <ExploreGearSection
        gear={{ cameraYears: [], cameraProfiles: [], lensFocalRanges: [] }}
        frames={[]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
