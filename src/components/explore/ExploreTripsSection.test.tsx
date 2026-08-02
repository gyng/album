/**
 * @jest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
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
  photos: [
    {
      date: "2016-11-13T23:09:00",
      album: "kansai",
      src: "/a.avif",
      href: "/album/kansai#a",
      label: "a",
    },
  ],
  ...over,
});

const outing = (id: string): TripSummary =>
  trip({
    id,
    startDate: id,
    endDate: id,
    dayCount: 1,
    photoCount: 3,
    isOuting: true,
    albums: ["snapshots"],
  });

describe("ExploreTripsSection", () => {
  it("leads with the journey, its span and where it went", () => {
    render(<ExploreTripsSection trips={[trip()]} />);

    expect(screen.getByText(/14 days/)).toBeInTheDocument();
    expect(screen.getByText(/167 photos/)).toBeInTheDocument();
    expect(screen.getByText(/Osaka/)).toBeInTheDocument();
  });

  // A journey assembled from two albums is the case an album page cannot show.
  it("names every album a trip draws from", () => {
    render(<ExploreTripsSection trips={[trip()]} />);

    expect(screen.getByText(/hyouka/)).toBeInTheDocument();
    expect(screen.getByText(/kansai/)).toBeInTheDocument();
  });

  it("reveals more trips on request, and stops offering when none are left", () => {
    const many = Array.from({ length: 9 }, (_, i) => outing(`2024-01-0${i + 1}`));
    render(<ExploreTripsSection trips={many} />);

    const before = screen.getAllByRole("listitem").length;
    expect(before).toBeLessThan(many.length);

    act(() => {
      screen.getByRole("button", { name: /more trips/i }).click();
    });
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(before);

    act(() => {
      screen.getByRole("button", { name: /more trips/i }).click();
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(many.length);
    expect(screen.queryByRole("button", { name: /more trips/i })).toBeNull();
  });

  // 58 of 94 clusters are a single afternoon; calling those "journeys" would be a lie.
  it("distinguishes a single-day outing from a journey", () => {
    render(<ExploreTripsSection trips={[outing("2024-05-01")]} />);

    expect(screen.getByRole("listitem")).toHaveTextContent(/outing · 3 photos/i);
  });

  it("renders nothing when no trip was detected", () => {
    const { container } = render(<ExploreTripsSection trips={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
