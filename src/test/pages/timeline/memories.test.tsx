/**
 * @jest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TimelinePage from "../../../pages/timeline/index";
import { TimelineEntry } from "../../../components/timelineTypes";

const mockReplace = jest.fn();
const mockUseRouter = jest.fn();

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

jest.mock("next/router", () => ({
  useRouter: () => mockUseRouter(),
}));

const mockCalendarHeatmap = jest.fn();

jest.mock("../../../components/CalendarHeatmap", () => ({
  CalendarHeatmap: (props: any) => {
    mockCalendarHeatmap(props);
    const years = Array.from(
      new Set(
        (props.entries ?? []).map((entry: TimelineEntry) =>
          Number.parseInt(entry.date.slice(0, 4), 10),
        ),
      ),
    ).sort((left, right) => right - left);
    const dates = Array.from(
      new Set((props.entries ?? []).map((entry: TimelineEntry) => entry.date)),
    );

    return (
      <div>
        {years.map((year) => (
          <h2 key={year} data-year-heading={year}>
            {year}
          </h2>
        ))}
        {dates.map((date) => (
          <button key={date} type="button" data-date={date}>
            {date}
          </button>
        ))}
      </div>
    );
  },
}));

jest.mock("../../../components/Nav", () => ({
  Nav: () => null,
}));

jest.mock("../../../components/Seo", () => ({
  Seo: () => null,
}));

jest.mock("../../../components/TimelineDayGrid", () => ({
  TimelineDayGrid: ({
    date,
    onSelectOlderDate,
    onSelectNewerDate,
  }: {
    date: string | null;
    onSelectOlderDate?: () => void;
    onSelectNewerDate?: () => void;
  }) => (
    <div>
      <div data-testid="selected-date">{date}</div>
      <button type="button" onClick={onSelectOlderDate}>
        older
      </button>
      <button type="button" onClick={onSelectNewerDate}>
        newer
      </button>
    </div>
  ),
}));

jest.mock("../../../services/album", () => ({
  getAlbums: jest.fn(),
}));

const makeEntry = (overrides: Partial<TimelineEntry>): TimelineEntry => ({
  album: "kansai",
  date: "2025-03-15",
  dateTimeOriginal: "2025-03-15T09:00:00.000Z",
  src: { src: "/memory.jpg", width: 200, height: 150 },
  href: "/album/kansai#memory.jpg",
  path: "../albums/kansai/memory.jpg",
  placeholderColor: "rgba(1, 2, 3, 1)",
  placeholderWidth: 200,
  placeholderHeight: 150,
  ...overrides,
});

describe("Timeline memories", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-03-15T12:00:00Z"));
    mockReplace.mockReset();
    mockCalendarHeatmap.mockReset();
    mockUseRouter.mockReturnValue({
      pathname: "/timeline",
      query: { filter_album: "kansai" },
      replace: mockReplace,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds memories from filtered entries and lets users jump to that date", async () => {
    render(
      <TimelinePage
        entries={[
          makeEntry({
            album: "kansai",
            date: "2025-03-15",
            href: "/album/kansai#kansai-memory.jpg",
            path: "../albums/kansai/kansai-memory.jpg",
          }),
          makeEntry({
            album: "tokyo",
            date: "2025-03-16",
            href: "/album/tokyo#tokyo-memory.jpg",
            path: "../albums/tokyo/tokyo-memory.jpg",
          }),
        ]}
      />,
    );

    expect(await screen.findByText("Memories")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /1 year ago · kansai · Mar 15, 2025/i,
      }),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/tokyo/i)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /jump to kansai on 2025-03-15/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("selected-date").textContent).toBe(
        "2025-03-15",
      );
    });
  });

  it("moves to the next older date without snapping back to the stale URL date", async () => {
    render(
      <TimelinePage
        entries={[
          makeEntry({
            album: "kansai",
            date: "2025-03-15",
            href: "/album/kansai#newer.jpg",
            path: "../albums/kansai/newer.jpg",
          }),
          makeEntry({
            album: "kansai",
            date: "2025-03-14",
            href: "/album/kansai#older.jpg",
            path: "../albums/kansai/older.jpg",
            dateTimeOriginal: "2025-03-14T09:00:00.000Z",
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "older" }));

    await waitFor(() => {
      expect(screen.getByTestId("selected-date").textContent).toBe(
        "2025-03-14",
      );
    });

    expect(mockReplace).toHaveBeenLastCalledWith(
      {
        pathname: "/timeline",
        query: { filter_album: "kansai", date: "2025-03-14" },
      },
      undefined,
      { shallow: true },
    );
  });

  it("reveals additional memory clusters on demand", async () => {
    render(
      <TimelinePage
        entries={[
          makeEntry({
            date: "2025-03-15",
            href: "/album/kansai#one.jpg",
            path: "../albums/kansai/one.jpg",
          }),
          makeEntry({
            date: "2024-03-14",
            href: "/album/kansai#two.jpg",
            path: "../albums/kansai/two.jpg",
            dateTimeOriginal: "2024-03-14T09:00:00.000Z",
          }),
          makeEntry({
            date: "2023-03-13",
            href: "/album/kansai#three.jpg",
            path: "../albums/kansai/three.jpg",
            dateTimeOriginal: "2023-03-13T09:00:00.000Z",
          }),
        ]}
      />,
    );

    expect(screen.queryByLabelText(/2023/i)).toBeNull();

    fireEvent.click(
      await screen.findByRole("button", { name: /more memories/i }),
    );

    expect(
      await screen.findByRole("button", {
        name: /3 years ago · kansai · Mar 13, 2023/i,
      }),
    ).toBeTruthy();
  });

  it("highlights matching dates in the heatmap while hovering a memory cluster", async () => {
    render(
      <TimelinePage
        entries={[
          makeEntry({
            date: "2025-03-15",
            href: "/album/kansai#one.jpg",
            path: "../albums/kansai/one.jpg",
          }),
          makeEntry({
            date: "2025-03-16",
            href: "/album/kansai#two.jpg",
            path: "../albums/kansai/two.jpg",
            dateTimeOriginal: "2025-03-16T09:00:00.000Z",
          }),
        ]}
      />,
    );

    fireEvent.mouseEnter(
      await screen.findByTestId("memory-cluster-2025-2025-03-15-2025-03-16"),
    );

    expect(
      screen.getByRole("button", { name: "2025-03-15" }).className,
    ).toMatch(/memoryHighlighted/);
    expect(
      screen.getByRole("button", { name: "2025-03-16" }).className,
    ).toMatch(/memoryHighlighted/);
    expect(screen.getByRole("heading", { name: "2025" }).className).toMatch(
      /highlightedYearHeading/,
    );

    fireEvent.mouseLeave(
      screen.getByTestId("memory-cluster-2025-2025-03-15-2025-03-16"),
    );

    expect(
      screen.getByRole("button", { name: "2025-03-15" }).className,
    ).not.toMatch(/memoryHighlighted/);
    expect(screen.getByRole("heading", { name: "2025" }).className).not.toMatch(
      /highlightedYearHeading/,
    );
  });

  it("clicking a memory label targets the matching calendar date", async () => {
    render(
      <TimelinePage
        entries={[
          makeEntry({
            date: "2025-03-15",
            href: "/album/kansai#one.jpg",
            path: "../albums/kansai/one.jpg",
          }),
          makeEntry({
            date: "2025-03-16",
            href: "/album/kansai#two.jpg",
            path: "../albums/kansai/two.jpg",
            dateTimeOriginal: "2025-03-16T09:00:00.000Z",
          }),
        ]}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: /1 year ago · kansai · Mar 15 - 16, 2025/i,
      }),
    );

    const lastCall =
      mockCalendarHeatmap.mock.calls[
        mockCalendarHeatmap.mock.calls.length - 1
      ]?.[0];
    expect(lastCall.scrollToDate).toBe("2025-03-15");
    expect(screen.getByTestId("selected-date").textContent).toBe("2025-03-15");
  });

  it("highlights matching dates in the heatmap while focusing a memory cluster", async () => {
    render(
      <TimelinePage
        entries={[
          makeEntry({
            date: "2025-03-15",
            href: "/album/kansai#one.jpg",
            path: "../albums/kansai/one.jpg",
          }),
          makeEntry({
            date: "2025-03-16",
            href: "/album/kansai#two.jpg",
            path: "../albums/kansai/two.jpg",
            dateTimeOriginal: "2025-03-16T09:00:00.000Z",
          }),
        ]}
      />,
    );

    const memoryButton = await screen.findByRole("button", {
      name: /1 year ago · kansai · Mar 15 - 16, 2025/i,
    });

    fireEvent.focus(memoryButton);

    expect(
      screen.getByRole("button", { name: "2025-03-15" }).className,
    ).toMatch(/memoryHighlighted/);
    expect(screen.getByRole("heading", { name: "2025" }).className).toMatch(
      /highlightedYearHeading/,
    );
  });

  it("supports slideshow-style keyboard navigation with arrow keys", async () => {
    render(
      <TimelinePage
        entries={[
          makeEntry({
            date: "2025-03-15",
            href: "/album/kansai#newer.jpg",
            path: "../albums/kansai/newer.jpg",
          }),
          makeEntry({
            date: "2025-03-14",
            href: "/album/kansai#older.jpg",
            path: "../albums/kansai/older.jpg",
            dateTimeOriginal: "2025-03-14T09:00:00.000Z",
          }),
        ]}
      />,
    );

    fireEvent.keyDown(window, { key: "ArrowLeft" });

    await waitFor(() => {
      expect(screen.getByTestId("selected-date").textContent).toBe(
        "2025-03-14",
      );
    });

    fireEvent.keyDown(window, { key: "ArrowRight" });

    await waitFor(() => {
      expect(screen.getByTestId("selected-date").textContent).toBe(
        "2025-03-15",
      );
    });
  });

  it("ignores arrow navigation while typing in an input", async () => {
    render(
      <>
        <input aria-label="scratch input" />
        <TimelinePage
          entries={[
            makeEntry({
              date: "2025-03-15",
              href: "/album/kansai#newer.jpg",
              path: "../albums/kansai/newer.jpg",
            }),
            makeEntry({
              date: "2025-03-14",
              href: "/album/kansai#older.jpg",
              path: "../albums/kansai/older.jpg",
              dateTimeOriginal: "2025-03-14T09:00:00.000Z",
            }),
          ]}
        />
      </>,
    );

    const input = screen.getByRole("textbox", { name: "scratch input" });
    input.focus();

    fireEvent.keyDown(input, { key: "ArrowLeft" });

    await waitFor(() => {
      expect(screen.getByTestId("selected-date").textContent).toBe(
        "2025-03-15",
      );
    });
  });
});
