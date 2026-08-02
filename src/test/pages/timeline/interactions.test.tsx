/**
 * @jest-environment jsdom
 */

import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithNextPlatform as render } from "../../renderWithNextPlatform";

let router = {
  query: {} as Record<string, string | string[]>,
  pathname: "/timeline",
  isReady: true,
  replace: jest.fn(),
};
let clusters: Array<any> = [];
let showHeatmapTarget = true;
let showDayHeading = true;
const dayGridProps = jest.fn();
const seoProps = jest.fn();

jest.mock("next/router", () => ({ useRouter: () => router }));
jest.mock("../../../services/album", () => ({ getAlbums: jest.fn() }));
jest.mock("../../../components/Seo", () => ({
  Seo: (props: unknown) => {
    seoProps(props);
    return null;
  },
}));
jest.mock("../../../components/GlobalNav", () => ({ GlobalNav: () => <nav /> }));
jest.mock("../../../components/ui", () => ({
  Caption: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Footer: () => <footer />,
  Heading: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
  PillButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Thumb: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt="" {...props} />,
}));
jest.mock("../../../util/clusterByDate", () => ({
  getMemoryClusters: () => clusters,
  formatMemoryDateRange: (start: string, end: string) =>
    start === end ? start : `${start} to ${end}`,
}));
jest.mock("../../../components/CalendarHeatmap", () => ({
  CalendarHeatmap: ({
    entries,
    highlightedDates = [],
    highlightedYears = [],
    selectedDate,
    onSelectDate,
  }: any) => (
    <div>
      {showHeatmapTarget && selectedDate ? (
        <button data-date={selectedDate}>selected heatmap date</button>
      ) : null}
      <span
        data-date="2024-07-14"
        className={highlightedDates.includes("2024-07-14") ? "memoryHighlighted" : ""}
      >
        memory day
      </span>
      <span
        data-year-heading="2024"
        className={highlightedYears.includes(2024) ? "highlightedYearHeading" : ""}
      >
        2024
      </span>
      <button onClick={() => onSelectDate(entries.at(-1)?.date ?? null)}>
        select heatmap date
      </button>
    </div>
  ),
}));
jest.mock("../../../components/TimelineDayGrid", () => ({
  TimelineDayGrid: (props: any) => {
    dayGridProps(props);
    return (
      <div>
        {showDayHeading ? <div ref={props.dateHeadingRef}>day heading</div> : null}
        <output data-testid="selected-date">{props.date ?? "none"}</output>
        <button onClick={props.onSelectRandomDate}>random date</button>
        <button onClick={props.onSelectOlderDate}>older date</button>
        <button onClick={props.onSelectNewerDate}>newer date</button>
      </div>
    );
  },
}));

import TimelinePage from "../../../screens/timeline/TimelineScreen";

const entry = (date: string, album = "trip", suffix = date) => ({
  album,
  date,
  dateTimeOriginal: `${date}T12:00:00`,
  decLat: null,
  decLng: null,
  geocode: null,
  src: { src: `/${suffix}.jpg`, width: 20, height: 10 },
  href: `/album/${album}#${suffix}`,
  path: `${suffix}.jpg`,
  placeholderColor: "rgba(1, 2, 3, 1)",
  placeholderWidth: 20,
  placeholderHeight: 10,
});

const entries = [entry("2026-07-14"), entry("2026-07-13"), entry("2026-07-12", "other")];

describe("timeline interactions", () => {
  let animationCallbacks: Map<number, FrameRequestCallback>;
  let nextFrame: number;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 14, 12));
    router = { query: {}, pathname: "/timeline", isReady: true, replace: jest.fn() };
    clusters = [];
    showHeatmapTarget = true;
    showDayHeading = true;
    dayGridProps.mockClear();
    seoProps.mockClear();
    animationCallbacks = new Map();
    nextFrame = 1;
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrame++;
      animationCallbacks.set(id, callback);
      return id;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      animationCallbacks.delete(id);
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 20,
      right: 300,
      bottom: 120,
      left: 20,
      width: 280,
      height: 100,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("navigates dates through controls, keyboard shortcuts, heatmap, and URL state", () => {
    router.query = { date: "2026-07-13", filter_album: "trip" };
    const { rerender } = render(<TimelinePage entries={entries as never} />);
    expect(screen.getByTestId("selected-date")).toHaveTextContent("2026-07-13");
    expect(screen.getByRole("link", { name: "trip" })).toHaveAttribute("href", "/album/trip");
    expect(seoProps).toHaveBeenLastCalledWith(expect.objectContaining({ noindex: true }));

    fireEvent.click(screen.getByRole("button", { name: "older date" }));
    expect(screen.getByTestId("selected-date")).toHaveTextContent("2026-07-13");
    fireEvent.click(screen.getByRole("button", { name: "newer date" }));
    expect(screen.getByTestId("selected-date")).toHaveTextContent("2026-07-14");
    fireEvent.click(screen.getByRole("button", { name: "older date" }));
    fireEvent.click(screen.getByRole("button", { name: "newer date" }));
    fireEvent.click(screen.getByRole("button", { name: "newer date" }));

    jest.spyOn(Math, "random").mockReturnValue(0.99);
    fireEvent.click(screen.getByRole("button", { name: "random date" }));
    expect(screen.getByTestId("selected-date")).toHaveTextContent("2026-07-13");
    fireEvent.click(screen.getByRole("button", { name: "select heatmap date" }));

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    input.contentEditable = "true";
    fireEvent.keyDown(input, { key: "ArrowRight" });
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    fireEvent.keyDown(textarea, { key: "ArrowLeft" });
    const select = document.createElement("select");
    document.body.append(select);
    fireEvent.keyDown(select, { key: "ArrowRight" });
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(editable);
    fireEvent.keyDown(editable, { key: "ArrowLeft" });

    router.replace.mockClear();
    router.query = { date: "2026-07-14" };
    rerender(<TimelinePage entries={entries as never} />);
    expect(screen.getByTestId("selected-date")).toHaveTextContent("2026-07-14");
    expect(router.replace).not.toHaveBeenCalled();
  });

  // The URL is how a day is shared and how the back button works. Once a deep
  // link has been applied, picking another day has to move ?date= with it —
  // the guard that protects hydration was refusing every later selection too,
  // so the URL froze on whichever day was first opened.
  it("keeps ?date= in step with later selections after a deep link", () => {
    router.query = { date: "2026-07-13" };
    render(<TimelinePage entries={entries as never} />);
    expect(screen.getByTestId("selected-date")).toHaveTextContent("2026-07-13");

    router.replace.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "newer date" }));

    expect(screen.getByTestId("selected-date")).toHaveTextContent("2026-07-14");
    expect(router.replace).toHaveBeenCalled();
    const target = String(router.replace.mock.calls.at(-1)?.[0] ?? "");
    expect(target).toContain("date=2026-07-14");
  });

  it("renders memories, highlights their heatmap dates, and loads more", () => {
    clusters = [
      {
        year: 2024,
        yearsAgo: 2,
        startDate: "2024-07-14",
        endDate: "2024-07-15",
        items: [
          entry("2024-07-14", "trip", "a"),
          { ...entry("2024-07-15", "other", "b"), placeholderColor: "transparent" },
        ],
      },
      {
        year: 2025,
        yearsAgo: 1,
        startDate: "2025-07-14",
        endDate: "2025-07-14",
        items: [{ ...entry("2025-07-14", "trip", "c"), placeholderColor: "transparent" }],
      },
      {
        year: 2023,
        yearsAgo: 3,
        startDate: "2023-07-14",
        endDate: "2023-07-14",
        items: [entry("2023-07-14", "trip", "d")],
      },
    ];
    render(<TimelinePage entries={entries as never} />);

    const first = screen.getByTestId("memory-cluster-2024-2024-07-14-2024-07-15");
    fireEvent.mouseEnter(first);
    expect(screen.getByText("memory day")).toHaveClass("memoryHighlighted");
    expect(screen.getByText("2024")).toHaveClass("highlightedYearHeading");
    fireEvent.mouseEnter(first);
    fireEvent.mouseEnter(screen.getByTestId("memory-cluster-2025-2025-07-14-2025-07-14"));
    fireEvent.mouseLeave(first);
    fireEvent.focus(first);
    fireEvent.blur(first, { relatedTarget: document.body });
    fireEvent.blur(first, { relatedTarget: first.querySelector("button") });

    fireEvent.click(screen.getByRole("button", { name: /2 years ago/ }));
    fireEvent.click(screen.getByRole("button", { name: "Jump to other on 2024-07-15" }));
    fireEvent.click(screen.getByRole("button", { name: "Load more memories" }));
    expect(screen.getByText("3 years ago")).toBeInTheDocument();
  });

  it("updates and clears the selected-date connector across layout changes", () => {
    const { unmount } = render(<TimelinePage entries={entries as never} />);
    const path = document.querySelector("svg path")!;
    expect(path.getAttribute("d")).toContain("M ");

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    const callback = Array.from(animationCallbacks.values()).at(-1);
    act(() => callback?.(0));
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    const scrollCallback = Array.from(animationCallbacks.values()).at(-1);
    act(() => scrollCallback?.(0));

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    const narrowCallback = Array.from(animationCallbacks.values()).at(-1);
    act(() => narrowCallback?.(0));
    expect(path.getAttribute("d")).toBe("");
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    unmount();
  });

  it("handles empty, future-only, invalid, and unready route states", () => {
    router.isReady = false;
    const empty = render(<TimelinePage entries={[]} />);
    expect(
      screen.getByText("No dated photos are available for this view yet."),
    ).toBeInTheDocument();
    empty.unmount();

    router.query = { date: ["not-a-string"] };
    const future = render(<TimelinePage entries={[entry("2030-01-01")] as never} />);
    fireEvent.click(screen.getByRole("button", { name: "random date" }));
    fireEvent.click(screen.getByRole("button", { name: "older date" }));
    fireEvent.click(screen.getByRole("button", { name: "newer date" }));
    expect(screen.getByTestId("selected-date")).toHaveTextContent("none");
    future.unmount();

    router.query = { date: "missing" };
    render(<TimelinePage entries={entries as never} />);
    expect(screen.getByTestId("selected-date")).toHaveTextContent("2026-07-14");
  });

  it("clears the connector when the selected heatmap target is absent", () => {
    showHeatmapTarget = false;
    render(<TimelinePage entries={entries as never} />);
    expect(document.querySelector("svg path")).toHaveAttribute("d", "");
  });

  it("does nothing until every connector ref is mounted", () => {
    showDayHeading = false;
    render(<TimelinePage entries={entries as never} />);
    expect(document.querySelector("svg path")).toHaveAttribute("d", "");
  });
});
