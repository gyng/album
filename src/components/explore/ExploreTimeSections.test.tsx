/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { PhotoStats } from "../../util/computeStats";
import { ExploreArchiveGaps, ExploreThisDaySection } from "./ExploreTimeSections";

describe("ExploreArchiveGaps", () => {
  const gaps: PhotoStats["archiveGaps"] = [
    { days: 1504, fromDate: "2011-04-05", toDate: "2015-05-18" },
    { days: 744, fromDate: "2020-10-19", toDate: "2022-11-02" },
  ];

  it("describes each silence in years and names the days either side", () => {
    render(<ExploreArchiveGaps gaps={gaps} dateRange={null} />);

    // 1504 days is over four years; the tenth is kept because "4 years" would
    // read as exact.
    expect(screen.getByText("4.1 years")).toBeInTheDocument();
    expect(screen.getByText("2 years")).toBeInTheDocument();
    expect(screen.getByText(/5 April 2011/)).toBeInTheDocument();
    expect(screen.getByText(/18 May 2015/)).toBeInTheDocument();
  });

  it("renders nothing for an archive with no gap", () => {
    const { container } = render(<ExploreArchiveGaps gaps={[]} dateRange={null} />);

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
