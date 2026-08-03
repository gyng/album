/**
 * @jest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
import type { TimelineEntry } from "../util/pageDataTypes";
import { TimelineTripsSection } from "./TimelineTripsSection";

const entry = (date: string, over: Partial<TimelineEntry> = {}): TimelineEntry =>
  ({
    album: "kansai",
    date: date.slice(0, 10),
    dateTimeOriginal: date,
    // The summarised form the timeline actually ships, not the raw blob.
    geocode: "Takayama, Gifu, Japan",
    src: { src: "/r/a.avif", width: 10, height: 10 },
    href: "/album/kansai#a.jpg",
    path: "../albums/kansai/a.jpg",
    placeholderColor: "rgb(1,2,3)",
    placeholderWidth: 10,
    placeholderHeight: 10,
    ...over,
  }) as unknown as TimelineEntry;

describe("TimelineTripsSection", () => {
  const journey = [
    entry("2016-11-13T10:00:00"),
    entry("2016-11-14T10:00:00"),
    entry("2016-11-15T10:00:00"),
  ];

  it("lists the journeys the entries contain", () => {
    render(<TimelineTripsSection entries={journey} onSelectDate={() => {}} />);

    expect(screen.getByText(/3 days/)).toBeInTheDocument();
    // Named as a place and again as a first visit, so take the places line.
    expect(screen.getAllByText(/Takayama/).length).toBeGreaterThan(0);
  });

  // The point of putting trips here rather than on explore: a trip is a way in
  // to the day view that already exists on this page.
  it("selects a day in the timeline when one of a trip's days is chosen", () => {
    const onSelectDate = jest.fn();
    render(<TimelineTripsSection entries={journey} onSelectDate={onSelectDate} />);

    act(() => {
      screen.getByRole("button", { name: /14 November 2016/ }).click();
    });

    expect(onSelectDate).toHaveBeenCalledWith("2016-11-14");
  });

  it("reveals more trips on request and stops offering when none remain", () => {
    const many = Array.from({ length: 9 }, (_, i) => entry(`2024-0${i + 1}-01T10:00:00`));
    render(<TimelineTripsSection entries={many} onSelectDate={() => {}} />);

    const first = screen.getAllByRole("listitem").length;
    expect(first).toBeLessThan(9);

    act(() => {
      screen.getByRole("button", { name: /more trips/i }).click();
    });
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(first);
  });

  // Reading the summarised geocode with the raw-blob helpers made every place
  // look like its own country, which broke a journey on every single day.
  it("reads the summarised geocode so a journey is not broken by each place", () => {
    render(
      <TimelineTripsSection
        entries={[
          entry("2016-11-13T10:00:00", { geocode: "Takayama, Gifu, Japan" }),
          entry("2016-11-14T10:00:00", { geocode: "Kanazawa, Ishikawa, Japan" }),
        ]}
        onSelectDate={() => {}}
      />,
    );

    expect(screen.getByText(/2 days/)).toBeInTheDocument();
    expect(screen.getByText(/Takayama → Kanazawa/)).toBeInTheDocument();
  });

  it("renders nothing when there is nothing dated to group", () => {
    const { container } = render(<TimelineTripsSection entries={[]} onSelectDate={() => {}} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the trip the reader is looking at", () => {
  const trips = [
    entry("2016-11-13T10:00:00"),
    entry("2016-11-14T10:00:00"),
    entry("2016-11-15T10:00:00"),
    entry("2020-02-07T10:00:00", { geocode: "Kamikawa, Hokkaido, Japan" }),
    entry("2021-03-07T10:00:00", { geocode: "Naha, Okinawa, Japan" }),
    entry("2022-04-07T10:00:00", { geocode: "Kyoto, Kyoto, Japan" }),
    entry("2023-05-07T10:00:00", { geocode: "Osaka, Osaka, Japan" }),
  ];

  // The page already knows which day is open. Without this the reader has to
  // find it again in a list of ninety-four.
  it("marks the day the timeline is showing", () => {
    render(
      <TimelineTripsSection entries={trips} onSelectDate={() => {}} selectedDate="2016-11-14" />,
    );

    const marked = screen.getByRole("button", { current: "date" });
    expect(marked).toHaveTextContent(/14 November 2016/);
  });

  // Newest first means an older trip can sit past the fold; the selected day
  // has to bring its own trip with it.
  it("shows the trip holding the selected day even when it is past the fold", () => {
    render(
      <TimelineTripsSection entries={trips} onSelectDate={() => {}} selectedDate="2016-11-14" />,
    );

    expect(screen.getByRole("button", { current: "date" })).toBeInTheDocument();
  });

  it("marks nothing when the open day belongs to no trip here", () => {
    render(
      <TimelineTripsSection entries={trips} onSelectDate={() => {}} selectedDate="1999-01-01" />,
    );

    expect(screen.queryByRole("button", { current: "date" })).not.toBeInTheDocument();
  });
});

describe("what the timeline says about a trip", () => {
  const archive = [
    entry("2015-05-01T10:00:00", { geocode: "Kyoto, Kyoto, Japan" }),
    entry("2016-11-13T10:00:00", { geocode: "Takayama, Gifu, Japan" }),
    entry("2016-11-14T10:00:00", { geocode: "Takayama, Gifu, Japan" }),
    entry("2022-04-07T10:00:00", { geocode: "Kyoto, Kyoto, Japan" }),
  ];

  // The same facts /trips reports. They cost nothing here: both come from the
  // entries this page already holds.
  it("names first visits and later returns", () => {
    render(<TimelineTripsSection entries={archive} onSelectDate={() => {}} />);

    expect(screen.getByText(/First time in Takayama/)).toBeInTheDocument();
    expect(screen.getByText(/Kyoto in 2022/)).toBeInTheDocument();
  });

  it("offers the whole trip on the trips page", () => {
    render(<TimelineTripsSection entries={archive} onSelectDate={() => {}} />);

    // Newest first, so the 2016 journey is not the first entry in the list.
    const links = screen
      .getAllByRole("link", { name: /whole trip/i })
      .map((link) => link.getAttribute("href"));
    expect(links).toContain("/trips#trip-2016-11-13");
  });

  // Fifty-eight single-day outings against thirty-six journeys: the list is
  // mostly outings, and a reader looking for a journey has to wade.
  it("can narrow the list to journeys", () => {
    render(<TimelineTripsSection entries={archive} onSelectDate={() => {}} />);
    // The 2015 outing is listed as its own trip, and as a day chip inside it.
    expect(screen.getAllByText(/1 May 2015/).length).toBeGreaterThan(0);

    act(() => {
      screen.getByRole("radio", { name: /journeys/i }).click();
    });

    expect(screen.queryByText(/1 May 2015/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/13 November 2016/).length).toBeGreaterThan(0);
  });
});
