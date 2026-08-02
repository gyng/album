/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { TripSummary } from "../../util/computeTrips";
import { ExploreTripsSection } from "./ExploreTripsSection";

const trip = (over: Partial<TripSummary> = {}): TripSummary => ({
  id: "2016-11-13",
  startDate: "2016-11-13",
  endDate: "2016-11-26",
  dayCount: 14,
  photoCount: 167,
  country: "Japan",
  places: ["Osaka", "Takayama", "Kyoto"],
  albums: ["hyouka", "kansai"],
  isOuting: false,
  totalKm: 1255,
  photos: [],
  ...over,
});

describe("ExploreTripsSection", () => {
  it("states how many journeys the archive contains", () => {
    render(
      <ExploreTripsSection trips={[trip(), trip({ id: "x", isOuting: true, dayCount: 1 })]} />,
    );

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/journey and 1 single-day outings/)).toBeInTheDocument();
  });

  it("describes the longest journey", () => {
    render(<ExploreTripsSection trips={[trip()]} />);

    expect(screen.getByText(/14 days across Osaka, Takayama, Kyoto/)).toBeInTheDocument();
  });

  // Browsing lives on the timeline; this page only reports the fact.
  it("links to where trips can actually be browsed", () => {
    render(<ExploreTripsSection trips={[trip()]} />);

    expect(screen.getByRole("link", { name: /browse every trip/i })).toHaveAttribute(
      "href",
      "/trips",
    );
  });

  it("renders nothing when no trip was detected", () => {
    const { container } = render(<ExploreTripsSection trips={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
