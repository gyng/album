import type { TimelineEntry } from "./timelineTypes";
import {
  formatCalendarLongDate,
  formatCalendarShortDate,
  formatCalendarWeekday,
  getCalendarDominantColor,
  getCalendarLevel,
  getCalendarPopupStyle,
  getCalendarWeekIndex,
  getCalendarYearDates,
} from "./calendarHeatmapModel";

const entry = (placeholderColor: string): TimelineEntry => ({
  album: "test",
  date: "2024-01-01",
  dateTimeOriginal: "2024-01-01T12:00:00",
  src: { src: "/photo.jpg", width: 100, height: 80 },
  href: "/album/test#photo.jpg",
  path: "../albums/test/photo.jpg",
  placeholderColor,
  placeholderWidth: 100,
  placeholderHeight: 80,
});

describe("calendarHeatmapModel", () => {
  it("formats stable calendar labels", () => {
    expect(formatCalendarShortDate("2024-02-29")).toBe("29 Feb 2024");
    expect(formatCalendarLongDate("2024-02-29")).toBe("29 February 2024");
    expect(formatCalendarWeekday("2024-02-29")).toBe("Thursday");
  });

  it("enumerates leap years and positions dates into Sunday-first weeks", () => {
    const leapDates = getCalendarYearDates(2024);
    expect(leapDates).toHaveLength(366);
    expect(leapDates.at(0)).toBe("2024-01-01");
    expect(leapDates.at(-1)).toBe("2024-12-31");
    expect(getCalendarYearDates(2023)).toHaveLength(365);
    expect(getCalendarWeekIndex(new Date("2024-01-01T00:00:00Z"))).toBe(0);
    expect(getCalendarWeekIndex(new Date("2024-01-07T00:00:00Z"))).toBe(1);
  });

  it.each([
    [-1, 0],
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [6, 3],
    [7, 4],
  ])("maps count %s to level %s", (count, level) => {
    expect(getCalendarLevel(count)).toBe(level);
  });

  it("derives saturated day colours across grayscale, red, green, and blue hues", () => {
    expect(getCalendarDominantColor([], 0)).toBeNull();
    expect(getCalendarDominantColor([entry("transparent"), entry("not-a-colour")], 2)).toBeNull();

    for (const colour of [
      "rgb(128, 128, 128)",
      "rgb(255, 0, 100)",
      "rgb(20, 240, 30)",
      "rgb(20, 30, 240)",
      "rgb(240, 220, 230)",
    ]) {
      expect(getCalendarDominantColor([entry(colour)], 1)).toMatch(/^rgb\(/);
    }
    expect(getCalendarDominantColor([entry("rgba(255, 0, 0, 0.5)")], 40)).toMatch(/^rgb\(/);
  });

  it("clamps popups within the viewport and above the trigger", () => {
    expect(getCalendarPopupStyle({ left: 0, top: 5, width: 10 }, 1000)).toEqual(
      expect.objectContaining({ left: "122px", top: "12px" }),
    );
    expect(getCalendarPopupStyle({ left: 490, top: 100, width: 20 }, 1000)).toEqual(
      expect.objectContaining({ left: "500px", top: "88px" }),
    );
    expect(getCalendarPopupStyle({ left: 990, top: 100, width: 20 }, 1000)).toEqual(
      expect.objectContaining({ left: "878px" }),
    );
  });
});
