/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { PhotoStats } from "../../util/computeStats";
import { ExploreArchiveGaps, ExploreThisDaySection, ExploreTimezones } from "./ExploreTimeSections";

const zones: PhotoStats["timezoneStats"] = {
  zoneCount: 3,
  coverage: 0.999,
  zones: [
    { name: "Asia/Tokyo", offsets: ["+09:00"], count: 932, sharePercent: 63 },
    { name: "Asia/Singapore", offsets: ["+08:00"], count: 274, sharePercent: 19 },
    { name: "Australia/Melbourne", offsets: ["+10:00", "+11:00"], count: 11, sharePercent: 1 },
  ],
};

describe("ExploreTimezones", () => {
  it("leads with how many zones the archive spans and lists them by weight", () => {
    render(<ExploreTimezones stats={zones} />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Tokyo")).toBeInTheDocument();
    expect(screen.getByText(/932/)).toBeInTheDocument();
  });

  // Melbourne is one place that reports two offsets across the year. Standing
  // it in both columns is the point: it is what proves the zone was resolved
  // per photograph rather than assumed once for the place.
  it("stands a zone in every offset it reported", () => {
    render(<ExploreTimezones stats={zones} />);

    expect(screen.getByText("+10:00")).toBeInTheDocument();
    expect(screen.getByText("+11:00")).toBeInTheDocument();
    expect(screen.getAllByText("Melbourne")).toHaveLength(2);
  });

  // A zone with a single photo, and one too small to round to a whole percent,
  // are both ordinary at the tail of a 16-zone list. The chart carries weight
  // as opacity, which is visible only — so the share is still said in words.
  it("counts one photo as singular and never claims a zone is 0%", () => {
    render(
      <ExploreTimezones
        stats={{
          zoneCount: 1,
          coverage: 1,
          zones: [{ name: "Asia/Kuala_Lumpur", offsets: ["+08:00"], count: 1, sharePercent: 0 }],
        }}
      />,
    );

    expect(screen.getByTitle(/1 photo, <1% of the archive/)).toBeInTheDocument();
  });

  it("renders nothing when no photo carries a zone", () => {
    const { container } = render(
      <ExploreTimezones stats={{ zoneCount: 0, coverage: 0, zones: [] }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("ExploreArchiveGaps", () => {
  const gaps: PhotoStats["archiveGaps"] = [
    { days: 1504, fromDate: "2011-04-05", toDate: "2015-05-18" },
    { days: 744, fromDate: "2020-10-19", toDate: "2022-11-02" },
  ];

  it("describes each silence in years and names the days either side", () => {
    render(<ExploreArchiveGaps gaps={gaps} />);

    // 1504 days is over four years; the tenth is kept because "4 years" would
    // read as exact.
    expect(screen.getByText("4.1 years")).toBeInTheDocument();
    expect(screen.getByText("2 years")).toBeInTheDocument();
    expect(screen.getByText(/5 April 2011/)).toBeInTheDocument();
    expect(screen.getByText(/18 May 2015/)).toBeInTheDocument();
  });

  it("renders nothing for an archive with no gap", () => {
    const { container } = render(<ExploreArchiveGaps gaps={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("ExploreThisDaySection", () => {
  const memories: PhotoStats["dayOfYearMemories"] = [
    {
      monthDay: "03-22",
      photos: [
        { year: 2024, date: "2024-03-22", src: "/b.avif", label: "Later" },
        { year: 2019, date: "2019-03-22", src: "/a.avif", label: "Earlier" },
      ],
    },
    {
      monthDay: "07-01",
      photos: [{ year: 2020, date: "2020-07-01", src: "/c.avif", label: "Other" }],
    },
  ];

  it("shows only the photos taken on the reader's own date", () => {
    render(<ExploreThisDaySection memories={memories} now={new Date(2026, 2, 22)} />);

    expect(screen.getByAltText("Later")).toBeInTheDocument();
    expect(screen.getByAltText("Earlier")).toBeInTheDocument();
    expect(screen.queryByAltText("Other")).toBeNull();
  });

  it("says how long ago each one was", () => {
    render(<ExploreThisDaySection memories={memories} now={new Date(2026, 2, 22)} />);

    expect(screen.getByText("2 years ago")).toBeInTheDocument();
    expect(screen.getByText("7 years ago")).toBeInTheDocument();
  });

  // Roughly half the calendar has no photograph on it, and an empty panel
  // saying so is worse than no panel.
  it("renders nothing on a day the archive never photographed", () => {
    const { container } = render(
      <ExploreThisDaySection memories={memories} now={new Date(2026, 0, 5)} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  // "Today" is the reader's, and the page is statically built, so the server
  // must not commit to a date it cannot know.
  it("renders nothing until the browser has supplied a date", () => {
    const { container } = render(<ExploreThisDaySection memories={memories} now={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
