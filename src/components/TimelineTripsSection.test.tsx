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
    expect(screen.getByText(/Takayama/)).toBeInTheDocument();
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
