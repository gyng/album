/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { CalendarHeatmap } from "./CalendarHeatmap";
import { TimelineEntry } from "./timelineTypes";

describe("CalendarHeatmap", () => {
  const entries: TimelineEntry[] = [
    {
      album: "kansai",
      date: "2024-01-02",
      dateTimeOriginal: "2024-01-02T10:00:00.000Z",
      src: { src: "/a.jpg", width: 200, height: 150 },
      href: "/album/kansai#a.jpg",
      placeholderColor: "rgb(1, 2, 3)",
      placeholderWidth: 200,
      placeholderHeight: 150,
    },
    {
      album: "kansai",
      date: "2024-01-02",
      dateTimeOriginal: "2024-01-02T11:00:00.000Z",
      src: { src: "/b.jpg", width: 200, height: 150 },
      href: "/album/kansai#b.jpg",
      placeholderColor: "rgb(4, 5, 6)",
      placeholderWidth: 200,
      placeholderHeight: 150,
    },
    {
      album: "tokyo",
      date: "2024-03-05",
      dateTimeOriginal: "2024-03-05T11:22:33.000Z",
      src: { src: "/c.jpg", width: 200, height: 150 },
      href: "/album/tokyo#c.jpg",
      placeholderColor: "rgb(7, 8, 9)",
      placeholderWidth: 200,
      placeholderHeight: 150,
    },
    {
      album: "osaka",
      date: "2023-12-31",
      dateTimeOriginal: "2023-12-31T22:00:00.000Z",
      src: { src: "/d.jpg", width: 200, height: 150 },
      href: "/album/osaka#d.jpg",
      placeholderColor: "rgb(10, 11, 12)",
      placeholderWidth: 200,
      placeholderHeight: 150,
    },
  ];

  it("renders year sections and selects a date when a populated cell is clicked", () => {
    const onSelectDate = jest.fn();

    render(
      <CalendarHeatmap
        entries={entries}
        selectedDate="2024-01-02"
        onSelectDate={onSelectDate}
      />,
    );

    expect(screen.getByRole("heading", { name: "2024" })).toBeTruthy();
    expect(screen.getAllByText("S")).toHaveLength(2); // S for Sunday and Saturday
    expect(
      screen.getByRole("button", { name: /jan 2, 2024/i }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /jan 2, 2024/i }));

    expect(onSelectDate).toHaveBeenCalledWith("2024-01-02");
  });

  it("shows a thumbnail preview popup with a remaining-count label on hover", () => {
    render(
      <CalendarHeatmap
        entries={entries}
        selectedDate="2024-01-02"
        onSelectDate={() => {}}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: /jan 2, 2024/i }));

    expect(screen.getByRole("link", { name: /view jan 2, 2024 preview/i })).toBeTruthy();
    expect(screen.getByText("+1 more")).toBeTruthy();
  });

  it("shows a text-only popup for empty dates", () => {
    render(
      <CalendarHeatmap
        entries={entries}
        selectedDate="2024-01-02"
        onSelectDate={() => {}}
        todayDate="2024-03-10"
      />,
    );

    fireEvent.mouseEnter(
      screen.getByRole("button", { name: /jan 1, 2024: no photos/i }),
    );

    expect(screen.getByText("Monday")).toBeTruthy();
    expect(screen.getByText("January 1, 2024")).toBeTruthy();
  });

  it("highlights today and suppresses populated pips for future dates", () => {
    render(
      <CalendarHeatmap
        entries={entries}
        selectedDate="2024-01-02"
        onSelectDate={() => {}}
        todayDate="2024-01-02"
      />,
    );

    expect(
      screen.getByRole("button", { name: /jan 2, 2024/i }).getAttribute(
        "aria-current",
      ),
    ).toBe("date");
    expect(
      screen.getByRole("button", { name: /mar 5, 2024: future date/i }).getAttribute(
        "aria-disabled",
      ),
    ).toBe("true");
  });

  it("highlights specified memory dates", () => {
    render(
      <CalendarHeatmap
        entries={entries}
        selectedDate="2024-01-02"
        onSelectDate={() => {}}
        highlightedDates={["2024-03-05"]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /mar 5, 2024/i }).className,
    ).toMatch(/memoryHighlighted/);
  });

  it("highlights specified years and can receive a scroll target", () => {
    const scrollIntoView = jest.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <CalendarHeatmap
        entries={entries}
        selectedDate="2024-01-02"
        onSelectDate={() => {}}
        highlightedYears={[2024]}
        scrollToDate="2024-03-05"
      />,
    );

    expect(screen.getByRole("heading", { name: "2024" }).className).toMatch(
      /highlightedYearHeading/,
    );
    expect(scrollIntoView).toHaveBeenCalled();

    HTMLElement.prototype.scrollIntoView = original;
  });
});
