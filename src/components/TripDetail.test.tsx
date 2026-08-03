/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { Trip } from "../util/computeTrips";
import { TripDetail } from "./TripDetail";

const routeMap = jest.fn();
jest.mock("./platform", () => ({
  ...jest.requireActual("./platform"),
  useClientComponents: () => ({
    TripRouteMap: (props: unknown) => {
      routeMap(props);
      return <div data-testid="route-map" />;
    },
  }),
}));

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
  point: null,
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
  laterReturns: [],
  totalKm: 1255,
  gear: { cameras: [], lenses: [], photosWithCamera: 0, photosWithLens: 0 },
  distinctiveTags: [],
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

describe("what the trip says about itself", () => {
  it("names the bodies and lenses carried, and what share each took", () => {
    render(
      <TripDetail
        trip={trip({
          photoCount: 167,
          gear: {
            cameras: [
              { name: "X100T", count: 153 },
              { name: "Pixel 7 Pro", count: 14 },
            ],
            lenses: [{ name: "XF16-80mmF4 R OIS WR", count: 100 }],
            photosWithCamera: 167,
            photosWithLens: 100,
          },
        })}
      />,
    );

    expect(screen.getByText(/X100T/)).toBeInTheDocument();
    expect(screen.getByText(/92%/)).toBeInTheDocument();
  });

  // Half this archive is a fixed-lens body that records no LensModel. Showing a
  // lens share against the whole trip would claim frames it cannot account for.
  it("measures lens shares against the frames that recorded a lens, and says so", () => {
    render(
      <TripDetail
        trip={trip({
          photoCount: 200,
          gear: {
            cameras: [{ name: "X-T5", count: 200 }],
            lenses: [{ name: "XF27mmF2.8 R WR", count: 50 }],
            photosWithCamera: 200,
            photosWithLens: 50,
          },
        })}
      />,
    );

    // 50 of the 50 that recorded one, not 25% of the trip.
    expect(screen.queryByText(/25%/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/100%/)).toHaveLength(2);
    expect(screen.getByText(/50 of 200/)).toBeInTheDocument();
  });

  it("shows nothing about gear when the cameras recorded none", () => {
    render(<TripDetail trip={trip()} />);

    expect(screen.queryByText(/carried/i)).not.toBeInTheDocument();
  });

  it("reports tags against the archive baseline rather than as bare counts", () => {
    render(
      <TripDetail
        trip={trip({
          distinctiveTags: [
            { tag: "moss", count: 12, times: 6.3 },
            { tag: "autumn", count: 20, times: 5.8 },
          ],
        })}
      />,
    );

    expect(screen.getByText(/moss/)).toBeInTheDocument();
    expect(screen.getByText(/6\.3×/)).toBeInTheDocument();
  });

  it("says when a place was returned to later, and in which year", () => {
    render(<TripDetail trip={trip({ laterReturns: [{ place: "Kyoto", year: 2022 }] })} />);

    expect(screen.getByText(/Kyoto in 2022/)).toBeInTheDocument();
  });
});

describe("the route map", () => {
  const located = () =>
    trip({
      days: [
        day({ date: "2016-11-13", point: { lat: 35.0, lng: 135.7 } }),
        day({ date: "2016-11-14", point: { lat: 34.6, lng: 135.5 } }),
      ],
    });

  beforeEach(() => routeMap.mockClear());

  // /trips lists every journey in the archive. Mounting a map per trip would
  // build ~90 WebGL contexts on one page, so nothing loads until asked.
  it("does not mount a map until the reader asks for one", () => {
    render(<TripDetail trip={located()} />);

    expect(screen.queryByTestId("route-map")).not.toBeInTheDocument();
    expect(routeMap).not.toHaveBeenCalled();
  });

  it("mounts the map when the reader asks, and hands it the trip", async () => {
    render(<TripDetail trip={located()} />);

    fireEvent.click(screen.getByRole("button", { name: /route/i }));

    expect(await screen.findByTestId("route-map")).toBeInTheDocument();
    expect(routeMap).toHaveBeenCalledWith(expect.objectContaining({ trip: expect.any(Object) }));
  });

  // A trip with no coordinates anywhere has no route; offering one would open
  // an empty map.
  it("offers nothing when no day on the trip knows where it was", () => {
    render(<TripDetail trip={trip()} />);

    expect(screen.queryByRole("button", { name: /route/i })).not.toBeInTheDocument();
  });
});
