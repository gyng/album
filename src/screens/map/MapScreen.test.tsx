/**
 * @jest-environment jsdom
 */

import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithNextPlatform as render } from "../../test/renderWithNextPlatform";
import type { MapWorldEntry } from "../../util/pageDataTypes";

const push = jest.fn();
const replace = jest.fn();
const mockRouterEvents = { on: jest.fn(), off: jest.fn() };
let mockQuery: Record<string, string> = {};
// A statically optimised Next page does not know its query on the first client
// render: `isReady` flips a tick later. Mutable so a test can live in that gap.
let mockRouterReady = true;

jest.mock("../../services/album", () => ({
  getAlbums: jest.fn(),
}));

// Keep the progressive search index load out of scope for this test: it
// only exercises the tour lifecycle, not the semantic search corpus.
jest.mock("../../util/mapSearchIndex", () => ({
  fetchMapSearchIndex: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock("next/router", () => ({
  useRouter: () => ({
    events: mockRouterEvents,
    query: mockQuery,
    isReady: mockRouterReady,
    push,
    replace,
  }),
}));

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      {...props}
      href={href}
      data-next-link="true"
      onClick={(event) => {
        onClick?.(event);

        if (!event.defaultPrevented) {
          event.preventDefault();
          push(href);
        }
      }}
    >
      {children}
    </a>
  ),
}));

const mapWorldDeferredMock = jest.fn<React.ReactElement, [Record<string, unknown>]>(() => (
  <div data-testid="map-world" />
));
jest.mock("../../components/MapWorldDeferred", () => ({
  MapWorldDeferred: (props: Record<string, unknown>) => {
    mapWorldDeferredMock(props);
    return <div data-testid="map-world" />;
  },
}));

const { default: MapScreen } = require("./MapScreen");

describe("MapScreen tour lifecycle", () => {
  const photos: MapWorldEntry[] = [
    {
      album: "kansai",
      src: { src: "/1.jpg", width: 100, height: 100 },
      decLat: 35,
      decLng: 139,
      date: "2024-01-01T00:00:00.000Z",
      href: "/album/kansai#1.jpg",
    },
    {
      album: "kansai",
      src: { src: "/2.jpg", width: 100, height: 100 },
      decLat: 35.1,
      decLng: 139.1,
      date: "2024-01-02T00:00:00.000Z",
      href: "/album/kansai#2.jpg",
    },
  ];

  beforeEach(() => {
    mockQuery = {};
    mockRouterReady = true;
    push.mockClear();
    replace.mockClear();
    mapWorldDeferredMock.mockClear();
  });

  const lastMapWorldProps = () =>
    mapWorldDeferredMock.mock.calls.at(-1)![0] as { directorEnabled: boolean };

  it("stops a running tour when the search query that scoped it is cleared", async () => {
    render(<MapScreen photos={photos} />);

    const searchInput = screen.getByRole("searchbox", { name: "Search photos on the map" });
    fireEvent.change(searchInput, { target: { value: "kansai" } });
    // Flush the progressive search-index load the query change kicks off.
    await act(async () => {});

    // The map itself reports how many stops a tour of the current results
    // would have; simulate it finding enough to make the Tour control appear.
    act(() => {
      const props = mapWorldDeferredMock.mock.calls.at(-1)![0] as {
        onDirectorSequenceLengthChange: (length: number) => void;
      };
      props.onDirectorSequenceLengthChange(2);
    });

    const tourButton = screen.getByRole("button", { name: /Tour/ });
    fireEvent.click(tourButton);
    expect(tourButton).toHaveAttribute("aria-pressed", "true");
    expect(lastMapWorldProps().directorEnabled).toBe(true);

    fireEvent.change(searchInput, { target: { value: "" } });

    expect(lastMapWorldProps().directorEnabled).toBe(false);
    expect(screen.queryByRole("button", { name: /Tour/ })).not.toBeInTheDocument();
  });

  it("never auto-fits a camera the URL has already framed", () => {
    // The camera params are only readable once the renderer says navigation is
    // ready, and the auto-fit is enabled by their *absence* — so for the first
    // render the map is told to frame every photo. If it mounts inside that
    // window it flies to a world view and the shared link is lost, which is
    // why every render has to be checked, not just the settled one.
    mockQuery = { lat: "35.681", lon: "139.767", zoom: "9.35" };
    mockRouterReady = false;
    const { rerender } = render(<MapScreen photos={photos} />);
    mockRouterReady = true;
    rerender(<MapScreen photos={photos} />);

    expect(mapWorldDeferredMock).toHaveBeenCalled();
    const fits = mapWorldDeferredMock.mock.calls.map(([props]) => props.fitToPhotos);
    expect(fits).not.toContain(true);
  });

  // The comment beside `fitToPhotos` promises a search filters in place. The
  // flag used to come back on as the field emptied, and the map flew out to
  // the whole library.
  it("leaves the camera where it is when a search is cleared", async () => {
    render(<MapScreen photos={photos} />);
    const searchInput = screen.getByRole("searchbox", { name: "Search photos on the map" });

    fireEvent.change(searchInput, { target: { value: "kansai" } });
    await act(async () => {});
    mapWorldDeferredMock.mockClear();
    fireEvent.change(searchInput, { target: { value: "" } });
    await act(async () => {});

    expect(mapWorldDeferredMock).toHaveBeenCalled();
    const fits = mapWorldDeferredMock.mock.calls.map(([props]) => props.fitToPhotos);
    expect(fits).not.toContain(true);
  });
});

describe("MapScreen URL state", () => {
  // One album, one day: the case a whole-day URL could not narrow.
  const photos: MapWorldEntry[] = [8, 12, 16, 20].map((hour) => ({
    album: "day",
    src: { src: `/${hour}.jpg`, width: 100, height: 100 },
    decLat: 35 + hour / 100,
    decLng: 139,
    date: `2024-03-22T${String(hour).padStart(2, "0")}:00:00`,
    href: `/album/day#${hour}.jpg`,
  }));
  const at = (hour: number) => Date.UTC(2024, 2, 22, hour);

  beforeEach(() => {
    jest.useFakeTimers();
    mockQuery = {};
    mockRouterReady = true;
    push.mockClear();
    replace.mockClear();
    mapWorldDeferredMock.mockClear();
    window.history.replaceState(null, "", "/map");
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const lastProps = () =>
    mapWorldDeferredMock.mock.calls.at(-1)![0] as {
      timeRange: { fromMs: number; toMs: number } | null;
      photos: MapWorldEntry[];
    };
  const lastReplacedSearch = () =>
    new URL(replace.mock.calls.at(-1)![0] as string, "https://example.test").searchParams;
  /** What the router does once a replace lands: the query changes under the screen. */
  const applyReplacedUrl = (rerender: (ui: React.ReactElement) => void) => {
    mockQuery = Object.fromEntries(lastReplacedSearch());
    rerender(<MapScreen photos={photos} />);
  };

  it("keeps a range narrower than a day through its own URL write", () => {
    const { rerender } = render(<MapScreen photos={photos} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Choose dates" })[0]!);

    fireEvent.keyDown(screen.getByRole("slider", { name: "Start date" }), { key: "PageUp" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "End date" }), { key: "PageDown" });
    const chosen = lastProps().timeRange!;
    expect(chosen.fromMs).toBeGreaterThan(at(8));
    expect(chosen.toMs).toBeLessThan(at(20));

    act(() => {
      jest.advanceTimersByTime(300);
    });
    applyReplacedUrl(rerender);

    expect(lastProps().timeRange).toEqual(chosen);
    expect(lastReplacedSearch().get("from")).toMatch(/^2024-03-22T\d\d:\d\d:\d\d$/);
  });

  it("still reads a whole-day link", () => {
    mockQuery = { from: "2024-03-22", to: "2024-03-22" };
    render(<MapScreen photos={photos} />);

    expect(lastProps().timeRange).toEqual({
      fromMs: Date.UTC(2024, 2, 22),
      toMs: Date.UTC(2024, 2, 22, 23, 59, 59, 999),
    });
  });

  it("opens on the search a link carries", async () => {
    mockQuery = { q: "kansai" };
    render(<MapScreen photos={photos} />);
    await act(async () => {});

    expect(screen.getByRole("searchbox", { name: "Search photos on the map" })).toHaveValue(
      "kansai",
    );
    const { fetchMapSearchIndex } = require("../../util/mapSearchIndex");
    expect(fetchMapSearchIndex).toHaveBeenCalled();
  });

  it("writes the search to the URL by replacement and removes it when cleared", async () => {
    const { rerender } = render(<MapScreen photos={photos} />);
    const searchInput = screen.getByRole("searchbox", { name: "Search photos on the map" });

    fireEvent.change(searchInput, { target: { value: "night market" } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(lastReplacedSearch().get("q")).toBe("night market");
    expect(push).not.toHaveBeenCalled();

    // The reader has typed on by the time the router reports the write; the
    // field must keep what they typed, not snap back to what was written.
    fireEvent.change(searchInput, { target: { value: "night markets" } });
    applyReplacedUrl(rerender);
    expect(searchInput).toHaveValue("night markets");

    window.history.replaceState(null, "", "/map?q=night+markets&lat=1");
    fireEvent.change(searchInput, { target: { value: "" } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(lastReplacedSearch().has("q")).toBe(false);
    expect(lastReplacedSearch().get("lat")).toBe("1");
  });

  it("marks the dates control while a range filters the map from a closed panel", () => {
    mockQuery = { from: "2024-03-22T10:00:00", to: "2024-03-22T18:00:00" };
    render(<MapScreen photos={photos} />);

    const hide = screen.getAllByRole("button", { name: "Hide date controls" })[0]!;
    expect(hide).not.toHaveAccessibleDescription();
    fireEvent.click(hide);

    const closed = screen.getAllByRole("button", { name: "Choose dates" })[0]!;
    expect(closed).toHaveAccessibleDescription(/22 Mar 2024/);
    expect(lastProps().timeRange).not.toBeNull();
  });

  it("does not mark the dates control when no range is set", () => {
    render(<MapScreen photos={photos} />);

    expect(
      screen.getAllByRole("button", { name: "Choose dates" })[0]!,
    ).not.toHaveAccessibleDescription();
  });
});
