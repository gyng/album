/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { Trip } from "../util/computeTrips";
import { TripDetail } from "./TripDetail";

const day = (over: Partial<Trip["days"][number]> = {}): Trip["days"][number] => ({
  date: "2016-11-16",
  count: 41,
  from: "09:02",
  to: "20:04",
  places: ["Hida", "Nanto"],
  photos: [],
  colour: "rgb(150, 156, 159)",
  hours: [9, 10, 20],
  coveredKm: 170.9,
  movedKm: 203.4,
  ...over,
});

const trip = (over: Partial<Trip> = {}): Trip => ({
  id: "2016-11-13",
  startDate: "2016-11-13",
  endDate: "2016-11-26",
  dayCount: 14,
  photoCount: 167,
  country: "Japan",
  places: ["Osaka", "Takayama"],
  albums: ["hyouka", "kansai"],
  isOuting: false,
  firstVisits: ["Takayama"],
  totalKm: 1255,
  days: [day()],
  ...over,
});

describe("TripDetail", () => {
  // The two distances answer different questions and both are needed: a day can
  // move 200km overnight and then cover almost nothing, or stay put and cover a
  // hundred wandering.
  it("separates the overnight move from the ground covered that day", () => {
    render(<TripDetail trip={trip()} />);

    expect(screen.getByText("203 km")).toBeInTheDocument();
    expect(screen.getByText(/171 km covered/)).toBeInTheDocument();
  });

  it("shows the day's shooting window and its average colour", () => {
    const { container } = render(<TripDetail trip={trip()} />);

    expect(screen.getByTitle("Photographed between 09:02 and 20:04")).toBeInTheDocument();
    expect(container.querySelector('[title="The day\'s average colour"]')).toHaveStyle({
      backgroundColor: "rgb(150, 156, 159)",
    });
  });

  it("calls out places reached for the first time", () => {
    render(<TripDetail trip={trip()} />);

    expect(screen.getByText(/First time in Takayama/)).toBeInTheDocument();
  });

  // A journey filed under two albums is the case no album page can show whole.
  it("names the albums when a journey spans more than one", () => {
    render(<TripDetail trip={trip()} />);

    expect(screen.getByText(/from hyouka and kansai/)).toBeInTheDocument();
  });

  it("omits an overnight move too small to mean a change of base", () => {
    render(<TripDetail trip={trip({ days: [day({ movedKm: 3 })] })} />);

    expect(screen.queryByText(/3 km$/)).toBeNull();
  });

  it("drops the day numbering for a single-day outing", () => {
    render(<TripDetail trip={trip({ isOuting: true, dayCount: 1, days: [day()] })} />);

    expect(screen.queryByText(/^Day 1$/)).toBeNull();
    expect(screen.getByText(/outing/)).toBeInTheDocument();
  });
});
