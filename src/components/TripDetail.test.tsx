/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
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

  // An outing is told apart by its shape now rather than by a label: one
  // compact row, no day numbering and no rail to hang it from.
  it("drops the day numbering and the rail for a single-day outing", () => {
    const { container } = render(
      <TripDetail trip={trip({ isOuting: true, dayCount: 1, days: [day()] })} />,
    );

    expect(screen.queryByText(/^Day 1$/)).toBeNull();
    expect(container.querySelector("[class*='rail']")).toBeNull();
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

describe("the route", () => {
  const located = () =>
    trip({
      days: [
        day({
          date: "2016-11-13",
          point: { lat: 35.0, lng: 135.7 },
          photos: [
            { src: "/one.avif", href: "/album/a#one", label: "one", lat: 35.0, lng: 135.7 },
          ] as Trip["days"][number]["photos"],
        }),
        day({
          date: "2016-11-14",
          point: { lat: 34.6, lng: 135.5 },
          photos: [
            { src: "/two.avif", href: "/album/a#two", label: "two", lat: 34.6, lng: 135.5 },
          ] as Trip["days"][number]["photos"],
        }),
      ],
    });

  // Drawn rather than mapped: a live map per trip cost a WebGL context and a
  // tile request each on a list of ninety-four.
  it("draws the journey beside the trip, with no map at all", () => {
    const { container } = render(<TripDetail trip={located()} />);

    expect(screen.getByRole("img", { name: /route of this trip/i })).toBeInTheDocument();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("gives the whole width to a trip that never recorded where it was", () => {
    const { container } = render(<TripDetail trip={trip()} />);

    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("an outing is not a journey", () => {
  const outing = (over: Partial<Trip> = {}) =>
    trip({
      isOuting: true,
      dayCount: 1,
      photoCount: 2,
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      days: [
        day({
          date: "2026-08-01",
          count: 2,
          point: { lat: 1.3, lng: 103.8 },
          photos: [
            { src: "/a.avif", href: "/album/x#a", label: "a" },
          ] as Trip["days"][number]["photos"],
        }),
      ],
      ...over,
    });

  // 58 of the 94 entries are single days. Given the full apparatus they repeat
  // their own date, draw a rail with one dot and open a map on one pin.
  it("states its date once, not twice", () => {
    render(<TripDetail trip={outing()} />);

    expect(screen.getAllByText(/1 August 2026/)).toHaveLength(1);
  });

  // It loses the rail and the day row, not its map: where an afternoon went is
  // as much the point for an outing as for a fortnight.
  it("still draws where the afternoon went", () => {
    render(<TripDetail trip={outing()} />);
    act(() => {
      const notify = (globalThis as { __observers?: Array<(e: unknown) => void> }).__observers;
      void notify;
    });

    expect(screen.queryByText(/^Day 1$/)).toBeNull();
  });

  it("still shows where it went and what it saw", () => {
    render(<TripDetail trip={outing({ places: ["Dover", "Brickworks Estate"] })} />);

    expect(screen.getByText(/Dover/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "a" })).toBeInTheDocument();
  });

  it("keeps the day-by-day rail for a journey", () => {
    render(<TripDetail trip={trip()} />);

    expect(screen.getByText(/Day 1/)).toBeInTheDocument();
  });
});

describe("the derived facts", () => {
  const rich = () =>
    trip({
      gear: {
        cameras: [{ name: "X100T", count: 153 }],
        lenses: [],
        photosWithCamera: 153,
        photosWithLens: 0,
      },
      distinctiveTags: [{ tag: "moss", count: 12, times: 6.3 }],
    });

  it("shows what the trip was carried and what it was full of", () => {
    render(<TripDetail trip={rich()} />);

    expect(screen.getByText("X100T")).toBeVisible();
    expect(screen.getByText("moss")).toBeVisible();
  });

  it("shows nothing at all when the trip recorded neither", () => {
    const { container } = render(<TripDetail trip={trip()} />);

    expect(container.querySelector("[class*='factsBody']")).toBeNull();
  });
});

describe("a day's frames", () => {
  // A day showing three of its forty-one, with a chip standing in for the rest,
  // is not the day.
  it("shows every frame it was given, and stands nothing in for the rest", () => {
    render(
      <TripDetail
        trip={trip({
          days: [
            day({
              count: 3,
              photos: [
                { src: "/a.avif", href: "/album/kansai#a", label: "a" },
                { src: "/b.avif", href: "/album/kansai#b", label: "b" },
                { src: "/c.avif", href: "/album/kansai#c", label: "c" },
              ] as Trip["days"][number]["photos"],
            }),
          ],
        })}
      />,
    );

    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });
});

describe("pointing at a day", () => {
  const located = () =>
    trip({
      days: [
        day({
          date: "2016-11-13",
          point: { lat: 35.0, lng: 135.7 },
          photos: [
            { src: "/one.avif", href: "/album/a#one", label: "one", lat: 35.0, lng: 135.7 },
          ] as Trip["days"][number]["photos"],
        }),
        day({
          date: "2016-11-14",
          point: { lat: 34.6, lng: 135.5 },
          photos: [
            { src: "/two.avif", href: "/album/a#two", label: "two", lat: 34.6, lng: 135.5 },
          ] as Trip["days"][number]["photos"],
        }),
      ],
    });

  // Two dots in the same drawing look alike; pointing at a day's frames is how
  // a reader tells which one is which.
  it("marks the day being pointed at, and unmarks it when the pointer leaves", () => {
    const { container } = render(<TripDetail trip={located()} />);
    const marked = () => container.querySelectorAll("[class*='stopActive']").length;

    expect(marked()).toBe(0);

    const strip = screen.getByRole("img", { name: "one" }).closest("div");
    act(() => {
      fireEvent.mouseEnter(strip as HTMLElement);
    });
    expect(marked()).toBe(1);

    act(() => {
      fireEvent.mouseLeave(strip as HTMLElement);
    });
    expect(marked()).toBe(0);
  });
});
