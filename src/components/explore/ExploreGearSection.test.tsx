/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { GearStats } from "../../util/computeGearStats";
import { ExploreGearSection } from "./ExploreGearSection";

const frame = (
  year: string,
  position: number,
  camera: string,
  lens: string | null,
  band: string | null,
) => ({
  year,
  position,
  camera,
  lens,
  band,
  src: `/${camera}-${position}.avif`,
  href: `/album/kyoto#${camera}-${position}`,
  label: `${camera} frame`,
  dateLabel: "4 May",
});

const gear = (overrides: Partial<GearStats> = {}): GearStats => ({
  // Totals agree with the frames below, the way the build's do: the stacked
  // view divides a year's total between series counted from those frames.
  cameraYears: [
    {
      label: "2023",
      total: 1,
      cameras: [{ camera: "X100T", count: 1, share: 100 }],
    },
    {
      label: "2024",
      total: 2,
      cameras: [
        { camera: "X100T", count: 1, share: 50 },
        { camera: "X-T5", count: 1, share: 50 },
      ],
    },
  ],
  focalYears: [
    {
      label: "2023",
      total: 1,
      bands: [{ band: "23–34mm · normal", count: 1, share: 100 }],
    },
    {
      label: "2024",
      total: 2,
      bands: [
        { band: "23–34mm · normal", count: 1, share: 50 },
        { band: "35–55mm · short tele", count: 1, share: 50 },
      ],
    },
  ],
  focalCoverage: 0.98,
  frames: [
    frame("2023", 0.1, "X100T", "23mm", "23–34mm · normal"),
    frame("2024", 0.2, "X100T", "23mm", "23–34mm · normal"),
    frame("2024", 0.6, "X-T5", "XF16-80mm", "35–55mm · short tele"),
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
      share: 0.2,
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
      peak: { from: 16, to: 48, count: 12, share: 75 },
      years: [
        {
          label: "2023",
          total: 8,
          bands: [
            { from: 16, to: 48, count: 8, share: 100 },
            { from: 48, to: 80, count: 0, share: 0 },
          ],
        },
        {
          label: "2024",
          total: 8,
          bands: [
            { from: 16, to: 48, count: 0, share: 0 },
            { from: 48, to: 80, count: 8, share: 100 },
          ],
        },
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

  // "6 photos · 0%" says the count beside it is a lie.
  it("names a share too small to round as under one per cent", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);

    expect(screen.getByText(/3 photos · <1%/)).toBeInTheDocument();
  });

  it("divides each year between the bodies that shot it", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);
    fireEvent.click(screen.getByRole("radio", { name: "Stacked" }));

    const shares = screen
      .getAllByTitle(/ in 2024: \d+ photos?,/)
      .map((segment) => segment.getAttribute("title"));

    expect(shares).toEqual(["X100T in 2024: 1 photo, 50%", "X-T5 in 2024: 1 photo, 50%"]);
  });

  // Two bodies and two lenses are four things a reader might have changed
  // between, and the bodies alone cannot show which.
  it("counts the lens on the body when asked to", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);
    fireEvent.click(screen.getByRole("radio", { name: "With lenses" }));
    fireEvent.click(screen.getByRole("radio", { name: "Stacked" }));

    expect(screen.getByTitle("X100T · 23mm in 2024: 1 photo, 50%")).toBeInTheDocument();
    expect(screen.getByTitle("X-T5 · XF16-80mm in 2024: 1 photo, 50%")).toBeInTheDocument();
  });

  // The tooltip's photograph is built only for the sliver being pointed at: one
  // in each of fifteen hundred would fetch the archive on scroll.
  it("brings up a photograph for the sliver under the pointer", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);

    // Queried through the DOM rather than by role: the tooltip repeats what the
    // sliver's own accessible name already says, so it is hidden from the tree.
    const preview = () => document.querySelectorAll('[class*="gearTooltipImage"]');
    expect(preview()).toHaveLength(0);

    fireEvent.focus(screen.getByRole("link", { name: /X-T5, 4 May 2024/ }));

    expect(preview()).toHaveLength(1);
    expect(preview()[0]?.getAttribute("alt")).toBe("X-T5 frame");
  });

  it("bands the same years by focal length as well", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);
    fireEvent.click(screen.getByRole("radio", { name: "By band" }));

    expect(screen.getByTitle("35–55mm · short tele in 2024: 1 photo, 50%")).toBeInTheDocument();
  });

  // One year is a bar, not a history — the timeline only earns its place once
  // there is a handover to see.
  it("keeps the timeline back until there is more than one year", () => {
    render(
      <ExploreGearSection
        gear={gear({
          cameraYears: [
            {
              label: "2024",
              total: 4,
              cameras: [{ camera: "X100T", count: 4, share: 100 }],
            },
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

  // The bars are drawn against the tallest one, so without the axis their
  // height is a shape with no scale and their position a range with no numbers.
  it("puts numbers on the lens axis", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);

    expect(screen.getByText("16mm")).toBeInTheDocument();
    expect(screen.getByText("80mm")).toBeInTheDocument();
    expect(screen.getByText("most at 16–48mm · 75%")).toBeInTheDocument();
  });

  it("follows a lens from year to year", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);

    expect(screen.getByTitle("16–48mm in 2023: 8 of 8")).toBeInTheDocument();
    expect(screen.getByTitle("48–80mm in 2024: 8 of 8")).toBeInTheDocument();
  });

  // A stacked bar cannot show a body arriving in June, which is what the frames
  // are for.
  // The archive as it happened opens first; a stacked bar cannot show a body
  // arriving in June.
  it("opens on every frame and switches to shares", () => {
    render(<ExploreGearSection gear={gear()} frames={frames} />);

    expect(screen.queryByTitle(/X-T5 in 2024/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('[class*="gearYearSliver"]').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("radio", { name: "Stacked" })[0]!);

    expect(screen.getByTitle("X-T5 in 2024: 1 photo, 50%")).toBeInTheDocument();
  });

  it("renders nothing at all when no photograph names its camera", () => {
    const { container } = render(
      <ExploreGearSection
        gear={{
          cameraYears: [],
          focalYears: [],
          focalCoverage: 0,
          frames: [],
          cameraProfiles: [],
          lensFocalRanges: [],
        }}
        frames={[]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
