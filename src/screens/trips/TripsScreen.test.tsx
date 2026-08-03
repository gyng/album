/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Trip } from "../../util/computeTrips";
import TripsScreen from "./TripsScreen";

jest.mock("../../components/GlobalNav", () => ({ GlobalNav: () => null }));
jest.mock("../../components/Seo", () => ({ Seo: () => null }));
jest.mock("../../components/ui", () => ({
  ...jest.requireActual("../../components/ui"),
  Footer: () => null,
}));

const trip = (over: Partial<Trip> = {}): Trip => ({
  id: over.startDate ?? "2016-11-13",
  startDate: "2016-11-13",
  endDate: "2016-11-26",
  dayCount: 14,
  photoCount: 167,
  country: "Japan",
  places: ["Osaka"],
  albums: ["kansai"],
  isOuting: false,
  firstVisits: [],
  laterReturns: [],
  totalKm: 1255,
  gear: { cameras: [], lenses: [], photosWithCamera: 0, photosWithLens: 0 },
  distinctiveTags: [],
  days: [
    {
      date: "2016-11-13",
      count: 1,
      from: "09:00",
      to: "10:00",
      places: [],
      photos: [],
      colour: null,
      hours: [],
      coveredKm: null,
      movedKm: null,
      point: null,
    },
  ],
  ...over,
});

const archive = [
  trip({ startDate: "2024-05-01", endDate: "2024-05-04", dayCount: 4, totalKm: 20 }),
  trip({ startDate: "2022-03-02", endDate: "2022-03-02", dayCount: 1, isOuting: true, totalKm: 5 }),
  trip({ startDate: "2016-11-13", endDate: "2016-11-26", dayCount: 14, totalKm: 1255 }),
  trip({ startDate: "2015-01-09", endDate: "2015-01-09", dayCount: 1, isOuting: true, totalKm: 2 }),
];

const headings = () =>
  screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent ?? "");

describe("TripsScreen", () => {
  it("opens on the most recent trip", () => {
    render(<TripsScreen trips={archive} />);

    expect(headings()[0]).toMatch(/1 May 2024/);
  });

  // 58 of 94 entries are single days. A reader after a journey should not have
  // to scroll past them.
  it("narrows the list to journeys or to outings", () => {
    render(<TripsScreen trips={archive} />);

    act(() => screen.getByRole("radio", { name: "Journeys" }).click());
    expect(headings()).toHaveLength(2);
    expect(headings().join(" ")).not.toMatch(/2 March 2022/);

    act(() => screen.getByRole("radio", { name: "Outings" }).click());
    expect(headings()).toHaveLength(2);
    expect(headings().join(" ")).toMatch(/2 March 2022/);
  });

  // Newest-first is a good default and a poor way to find the big journeys in
  // ninety-four entries.
  it("sorts by how long a trip was, and by how far it went", () => {
    render(<TripsScreen trips={archive} />);

    fireEvent.change(screen.getByLabelText(/sort/i), { target: { value: "days" } });
    expect(headings()[0]).toMatch(/13 November 2016/);

    fireEvent.change(screen.getByLabelText(/sort/i), { target: { value: "distance" } });
    expect(headings()[0]).toMatch(/13 November 2016/);
  });

  // Eleven clicks of "load more" to reach 2015 is not navigation.
  it("jumps to a year", () => {
    render(<TripsScreen trips={archive} />);

    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: "2015" } });

    expect(headings()).toHaveLength(1);
    expect(headings()[0]).toMatch(/9 January 2015/);
  });

  it("says when a filter leaves nothing to show", () => {
    render(<TripsScreen trips={[archive[1] as Trip]} />);

    act(() => screen.getByRole("radio", { name: "Journeys" }).click());

    expect(screen.getByText(/no trips match/i)).toBeInTheDocument();
  });

  it("gives every trip a link of its own", () => {
    render(<TripsScreen trips={archive} />);

    expect(screen.getAllByRole("link", { name: /link to this trip/i })[0]).toHaveAttribute(
      "href",
      "#trip-2024-05-01",
    );
  });
});
