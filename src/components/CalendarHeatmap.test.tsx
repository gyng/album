/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { CalendarHeatmap } from "./CalendarHeatmap";
import type { TimelineEntry } from "../util/pageDataTypes";

describe("CalendarHeatmap", () => {
  const entries: TimelineEntry[] = [
    {
      album: "kansai",
      date: "2024-01-02",
      dateTimeOriginal: "2024-01-02T10:00:00.000Z",
      src: { src: "/a.jpg", width: 200, height: 150 },
      href: "/album/kansai#a.jpg",
      path: "../albums/kansai/a.jpg",
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
      path: "../albums/kansai/b.jpg",
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
      path: "../albums/tokyo/c.jpg",
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
      path: "../albums/osaka/d.jpg",
      placeholderColor: "rgb(10, 11, 12)",
      placeholderWidth: 200,
      placeholderHeight: 150,
    },
  ];

  it("renders year sections and selects a date when a populated cell is clicked", () => {
    const onSelectDate = jest.fn();

    render(
      <CalendarHeatmap entries={entries} selectedDate="2024-01-02" onSelectDate={onSelectDate} />,
    );

    expect(screen.getByRole("heading", { name: "2024" })).toBeTruthy();
    expect(screen.getAllByText("S")).toHaveLength(2); // S for Sunday and Saturday
    expect(screen.getByRole("button", { name: /^2 Jan 2024:/i }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: /^2 Jan 2024:/i }));

    expect(onSelectDate).toHaveBeenCalledWith("2024-01-02");
  });

  it("renders recent years first and progressively reveals older years", () => {
    const manyYears = [2025, 2024, 2023, 2022].map((year, index) => ({
      ...entries[0],
      date: `${year}-01-02`,
      dateTimeOriginal: `${year}-01-02T10:00:00`,
      href: `/album/kansai#${year}.jpg`,
      path: `../albums/kansai/${year}.jpg`,
      src: { ...entries[0]!.src, src: `/${year}.jpg` },
      placeholderColor: `rgb(${index + 1}, 2, 3)`,
    }));

    render(
      <CalendarHeatmap entries={manyYears} selectedDate="2025-01-02" onSelectDate={jest.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "2025" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2024" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "2023" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show 2 earlier years" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show 2 earlier years" }));

    expect(screen.getByRole("heading", { name: "2023" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2022" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /earlier years/i })).toBeNull();
  });

  it("shows a thumbnail preview popup with a remaining-count label on hover", () => {
    render(<CalendarHeatmap entries={entries} selectedDate="2024-01-02" onSelectDate={() => {}} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^2 Jan 2024:/i }));

    expect(screen.getByRole("link", { name: /view 2 jan 2024 preview/i })).toBeTruthy();
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

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^1 Jan 2024: no photos/i }));

    expect(screen.getByText("Monday")).toBeTruthy();
    expect(screen.getByText("1 January 2024")).toBeTruthy();
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

    expect(screen.getByRole("button", { name: /^2 Jan 2024:/i }).getAttribute("aria-current")).toBe(
      "date",
    );
    expect(
      screen
        .getByRole("button", { name: /^5 Mar 2024: future date/i })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("does not fabricate a today ring from the build clock when todayDate is absent", () => {
    const now = new Date();
    const pad = (value: number) => `${value}`.padStart(2, "0");
    const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    render(
      <CalendarHeatmap
        entries={[{ ...entries[0], date: todayKey, href: "/album/kansai#today.jpg" }]}
        selectedDate={null}
        onSelectDate={() => {}}
      />,
    );

    // With no todayDate provided (server render), the heatmap must not derive a
    // "today" marker from the build machine's clock.
    expect(document.querySelector('[aria-current="date"]')).toBeNull();
  });

  it("highlights specified memory dates", () => {
    render(
      <CalendarHeatmap
        entries={entries}
        selectedDate="2024-01-02"
        onSelectDate={() => {}}
        highlightedDates={["2024-03-05", "2024-01-02"]}
      />,
    );

    expect(screen.getByRole("button", { name: /^5 Mar 2024:/i }).className).toMatch(
      /memoryHighlighted/,
    );
    expect(screen.getByRole("button", { name: /^2 Jan 2024:/i }).className).toMatch(
      /memoryHighlighted/,
    );
  });

  it("highlights specified years and can receive a scroll target", () => {
    const scrollIntoView = jest.fn();
    const scrollSpy = jest
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(scrollIntoView);

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

    scrollSpy.mockRestore();
  });

  it("uses instant scrolling for reduced motion and tolerates a missing target", () => {
    const scrollIntoView = jest.fn();
    const scrollSpy = jest
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(scrollIntoView);
    const media = jest
      .spyOn(window, "matchMedia")
      .mockReturnValue({ matches: true } as MediaQueryList);
    const view = render(
      <CalendarHeatmap
        entries={entries}
        selectedDate={null}
        onSelectDate={jest.fn()}
        scrollToDate="2024-01-02"
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
    view.rerender(
      <CalendarHeatmap
        entries={entries}
        selectedDate={null}
        onSelectDate={jest.fn()}
        scrollToDate="2099-01-01"
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    media.mockRestore();
    scrollSpy.mockRestore();
  });

  it("caps unique colour pips and ignores transparent or repeated swatches", () => {
    const colours = [
      "rgb(1, 2, 3)",
      "rgb(1, 2, 3)",
      "transparent",
      "",
      "rgb(4, 5, 6)",
      "rgb(7, 8, 9)",
      "rgb(10, 11, 12)",
      "rgb(13, 14, 15)",
    ];
    render(
      <CalendarHeatmap
        entries={colours.map((placeholderColor, index) => ({
          ...entries[0],
          href: `/album/kansai#${index}.jpg`,
          path: `../albums/kansai/${index}.jpg`,
          placeholderColor,
        }))}
        selectedDate={null}
        onSelectDate={jest.fn()}
        highlightedDates={["2024-01-02"]}
      />,
    );
    const cell = screen.getByRole("button", { name: /^2 Jan 2024: 8 photos/i });
    expect(cell.className).toContain("level4");
    expect(cell.querySelectorAll(".subpip")).toHaveLength(4);
    expect(cell.querySelectorAll(".highlightedSubpip")).toHaveLength(4);
  });

  it("handles popup focus, delayed close, re-entry, and unmount cleanup", () => {
    jest.useFakeTimers();
    const view = render(
      <CalendarHeatmap entries={entries} selectedDate={null} onSelectDate={jest.fn()} />,
    );
    const cell = screen.getByRole("button", { name: /^2 Jan 2024:/i });
    fireEvent.focus(cell);
    expect(screen.getByRole("link", { name: /view 2 jan 2024 preview/i })).toBeInTheDocument();
    fireEvent.blur(cell);
    fireEvent.blur(cell);
    const popup = screen.getByRole("link", { name: /view 2 jan 2024 preview/i }).parentElement!;
    fireEvent.mouseEnter(popup);
    act(() => {
      jest.advanceTimersByTime(120);
    });
    expect(screen.getByRole("link", { name: /view 2 jan 2024 preview/i })).toBeInTheDocument();
    fireEvent.mouseLeave(popup);
    expect(screen.queryByRole("link", { name: /view 2 jan 2024 preview/i })).toBeNull();

    fireEvent.mouseEnter(cell);
    fireEvent.mouseLeave(cell);
    view.unmount();
    jest.useRealTimers();
  });

  it("selects all photos from the popup and closes after the delay", () => {
    jest.useFakeTimers();
    const onSelectDate = jest.fn();
    render(<CalendarHeatmap entries={entries} selectedDate={null} onSelectDate={onSelectDate} />);
    const cell = screen.getByRole("button", { name: /^2 Jan 2024:/i });
    fireEvent.mouseEnter(cell);
    fireEvent.click(screen.getByRole("button", { name: "+1 more" }));
    expect(onSelectDate).toHaveBeenCalledWith("2024-01-02");
    expect(screen.queryByText("+1 more")).toBeNull();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^5 Mar 2024:/i }));
    expect(screen.queryByRole("button", { name: /more/ })).toBeNull();
    fireEvent.mouseEnter(
      screen.getByRole("link", { name: /view 5 mar 2024 preview/i }).parentElement!,
    );
    fireEvent.mouseLeave(screen.getByRole("button", { name: /^5 Mar 2024:/i }));
    act(() => {
      jest.advanceTimersByTime(120);
    });
    expect(screen.queryByRole("link", { name: /view 5 mar 2024 preview/i })).toBeNull();
    jest.useRealTimers();
  });

  it("renders safely without any year groups", () => {
    const { container } = render(
      <CalendarHeatmap entries={[]} selectedDate={null} onSelectDate={jest.fn()} />,
    );
    expect(container.querySelectorAll("section")).toHaveLength(0);
  });
});
