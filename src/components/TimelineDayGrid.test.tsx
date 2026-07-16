/**
 * @jest-environment jsdom
 */

import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TimelineDayGrid } from "./TimelineDayGrid";
import type { TimelineEntry } from "../util/pageDataTypes";

const mapProps = jest.fn();
jest.mock("./MapWorldDeferred", () => ({
  MapWorldDeferred: (props: { className: string }) => {
    mapProps(props);
    return <div data-testid="timeline-map" className={props.className} />;
  },
}));

describe("TimelineDayGrid", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(new Date("2024-01-03T12:00:00.000Z").getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const entries: TimelineEntry[] = [
    {
      album: "kansai",
      date: "2024-01-02",
      dateTimeOriginal: "2024-01-02T12:00:00.000Z",
      decLat: 35.6,
      decLng: 139.7,
      geocode: "JP\nAkihabara\n35.6\n139.7\n77200\nTokyo\nChiyoda-ku\nJapan",
      src: { src: "/a.jpg", width: 200, height: 150 },
      href: "/album/kansai#a.jpg",
      path: "/data/albums/kansai/a.jpg",
      placeholderColor: "rgb(1, 2, 3)",
      placeholderWidth: 200,
      placeholderHeight: 150,
    },
    {
      album: "tokyo",
      date: "2024-01-02",
      dateTimeOriginal: "2024-01-02T16:00:00.000Z",
      decLat: null,
      decLng: null,
      geocode: "JP\nŌme\n35.7\n139.2\n131895\nTokyo\nJapan",
      src: { src: "/b.jpg", width: 200, height: 150 },
      href: "/album/tokyo#b.jpg",
      path: "/data/albums/tokyo/b.jpg",
      placeholderColor: "rgb(4, 5, 6)",
      placeholderWidth: 200,
      placeholderHeight: 150,
    },
  ];

  it("renders a wrapping day grid with photo links for the selected date", () => {
    render(<TimelineDayGrid date="2024-01-02" entries={entries} />);

    expect(screen.getByRole("heading", { name: /2 january 2024/i })).toBeTruthy();
    expect(screen.getByText("2 photos")).toBeTruthy();
    expect(screen.getByLabelText("Location summary").textContent).toContain(
      "Akihabara, Chiyoda-ku, Japan",
    );
    expect(screen.getByText("yesterday")).toBeTruthy();
    expect(screen.getByText("20 hours ago")).toBeTruthy();
    expect(screen.getByText("kansai")).toBeTruthy();
    expect(screen.getByText("tokyo")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Map" })).toBeTruthy();
    expect(screen.getByText("1 mapped photo")).toBeTruthy();
    expect(screen.getByTestId("timeline-map")).toBeTruthy();
    expect(document.querySelector('a[href="/album/kansai#a.jpg"]')).toBeTruthy();
    expect(document.querySelector('a[href="/album/tokyo#b.jpg"]')).toBeTruthy();
    const similarLinks = screen.getAllByRole("link", {
      name: /find similar photos/i,
    });
    expect(similarLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/search?similar=..%2Falbums%2Fkansai%2Fa.jpg",
      "/search?similar=..%2Falbums%2Ftokyo%2Fb.jpg",
    ]);
    expect(screen.getByText("yesterday").getAttribute("title")).toBe("2 January 2024 at 12:00");
  });

  it("renders an empty state when no date is selected", () => {
    const onSelectRandomDate = jest.fn();
    const onSelectOlderDate = jest.fn();
    const onSelectNewerDate = jest.fn();
    render(
      <TimelineDayGrid
        date={null}
        entries={[]}
        onSelectRandomDate={onSelectRandomDate}
        onSelectOlderDate={onSelectOlderDate}
        onSelectNewerDate={onSelectNewerDate}
      />,
    );

    expect(screen.getByRole("heading", { name: /pick a day/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /random/i }));
    expect(onSelectRandomDate).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /older/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /newer/i })).toBeDisabled();
  });

  it("omits optional navigation from the unselected state", () => {
    render(<TimelineDayGrid date={null} entries={[]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("supports available day navigation and forwards map data", () => {
    const onSelectRandomDate = jest.fn();
    const onSelectOlderDate = jest.fn();
    const onSelectNewerDate = jest.fn();
    const dateHeadingRef = createRef<HTMLDivElement>();
    mapProps.mockClear();
    const secondMapped = { ...entries[1], decLat: 35.7, decLng: 139.2 };
    render(
      <TimelineDayGrid
        date="2024-01-02"
        entries={[entries[0], secondMapped]}
        onSelectRandomDate={onSelectRandomDate}
        onSelectOlderDate={onSelectOlderDate}
        onSelectNewerDate={onSelectNewerDate}
        canGoOlder
        canGoNewer
        dateHeadingRef={dateHeadingRef}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /older/i }));
    fireEvent.click(screen.getByRole("button", { name: /random/i }));
    fireEvent.click(screen.getByRole("button", { name: /newer/i }));
    expect(onSelectOlderDate).toHaveBeenCalled();
    expect(onSelectRandomDate).toHaveBeenCalled();
    expect(onSelectNewerDate).toHaveBeenCalled();
    expect(dateHeadingRef.current).toContainElement(
      screen.getByRole("heading", { name: /2 January 2024/i }),
    );
    expect(screen.getByText("2 mapped photos")).toBeInTheDocument();
    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({
        photos: expect.arrayContaining([
          expect.objectContaining({ album: "kansai", decLat: 35.6, decLng: 139.7 }),
          expect.objectContaining({ album: "tokyo", decLat: 35.7, decLng: 139.2 }),
        ]),
        fitToPhotos: true,
        syncRoute: false,
        showThemeBootstrap: false,
      }),
    );
  });

  it("waits until the map is near the viewport before loading MapLibre", () => {
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    let notify!: IntersectionObserverCallback;
    const observe = jest.fn();
    const disconnect = jest.fn();
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: jest.fn((callback: IntersectionObserverCallback) => {
        notify = callback;
        return { observe, disconnect };
      }),
    });

    render(<TimelineDayGrid date="2024-01-02" entries={entries} />);

    expect(screen.queryByTestId("timeline-map")).toBeNull();
    expect(observe).toHaveBeenCalledTimes(1);

    act(() => {
      notify(
        [{ target: observe.mock.calls[0]![0], isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(screen.getByTestId("timeline-map")).toBeInTheDocument();
    expect(disconnect).toHaveBeenCalled();

    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: originalIntersectionObserver,
    });
  });

  it("disables unavailable selected-day navigation", () => {
    render(
      <TimelineDayGrid
        date="2024-01-02"
        entries={[]}
        onSelectOlderDate={jest.fn()}
        onSelectNewerDate={jest.fn()}
        canGoOlder={false}
        canGoNewer={false}
      />,
    );
    expect(screen.getByRole("button", { name: /older/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /newer/i })).toBeDisabled();
    expect(screen.queryByLabelText("Location summary")).toBeNull();
    expect(screen.queryByTestId("timeline-map")).toBeNull();
  });

  it("cleans varied geocodes and tolerates invalid timestamps and source paths", () => {
    const variants: TimelineEntry[] = [
      {
        ...entries[0],
        album: "unknown",
        href: "/album/unknown#one.jpg",
        path: "custom/one.jpg",
        dateTimeOriginal: "not-a-date",
        geocode: null,
        decLat: undefined,
        decLng: undefined,
      },
      {
        ...entries[0],
        album: "coordinates",
        href: "/album/coordinates#two.jpg",
        path: "custom/two.jpg",
        geocode: "35.6\n139.7",
        decLng: undefined,
      },
      {
        ...entries[0],
        album: "code-only",
        href: "/album/code-only#three.jpg",
        path: "custom/three.jpg",
        geocode: "JP",
        decLat: undefined,
      },
      {
        ...entries[0],
        album: "paris",
        href: "/album/paris#four.jpg",
        path: "custom/four.jpg",
        geocode: "Paris\nFrance",
        decLat: null,
        decLng: null,
      },
      {
        ...entries[0],
        album: "tokyo",
        href: "/album/tokyo#five.jpg",
        path: "custom/five.jpg",
        geocode: "JP\nTokyo\nKanto\nJapan",
        decLat: null,
        decLng: null,
      },
    ];
    render(<TimelineDayGrid date="2024-01-02" entries={variants} />);
    expect(screen.getByLabelText("Location summary")).toHaveTextContent(
      "Paris, France · Tokyo, Kanto, Japan",
    );
    expect(screen.getByText("5 photos")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-map")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Find similar photos" })[0]).toHaveAttribute(
      "href",
      "/search?similar=custom%2Fone.jpg",
    );
    expect(screen.getByRole("link", { name: "unknown 2 January 2024" })).not.toHaveAttribute(
      "title",
    );
    fireEvent.click(screen.getAllByRole("link", { name: "Find similar photos" })[0]);
  });

  it("uses singular photo copy for one unmapped entry", () => {
    render(
      <TimelineDayGrid
        date="2024-01-02"
        entries={[{ ...entries[0], decLat: null, decLng: null, geocode: "Paris\nParis" }]}
      />,
    );
    expect(screen.getByText("1 photo")).toBeInTheDocument();
    expect(screen.getByLabelText("Location summary")).toHaveTextContent("Paris");
  });

  it("falls back to the supplied day key when it cannot be formatted", () => {
    render(<TimelineDayGrid date="not-a-day" entries={[]} />);
    expect(screen.getByRole("heading", { name: "not-a-day" })).toBeInTheDocument();
  });
});
