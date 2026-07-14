/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

let query: Record<string, string | string[]> = {};
const replace = jest.fn();
let buildId: string | null = "build-1";
const fetchIndex = jest.fn();
const mapProps = jest.fn();

jest.mock("next/router", () => ({ useRouter: () => ({ query, replace }) }));
jest.mock("../../../services/album", () => ({ getAlbums: jest.fn() }));
jest.mock("../../../services/buildTiming", () => ({
  measureBuild: (_name: string, work: () => unknown) => work(),
}));
jest.mock("../../../components/GlobalNav", () => ({
  GlobalNav: ({ extraItems }: { extraItems: React.ReactNode }) => (
    <nav>
      <ul>{extraItems}</ul>
    </nav>
  ),
}));
jest.mock("../../../components/Seo", () => ({ Seo: () => null }));
jest.mock("../../../components/MapWorldDeferred", () => ({
  MapWorldDeferred: (props: unknown) => {
    mapProps(props);
    return <div data-testid="map" />;
  },
}));
jest.mock("../../../components/TimeRangeSlider", () => ({
  TimeRangeSlider: ({
    onDrag,
    onCommit,
  }: {
    onDrag: (from: number, to: number) => void;
    onCommit: (from: number | null, to: number | null) => void;
  }) => (
    <div>
      <button onClick={() => onDrag(Date.UTC(2024, 0, 2), Date.UTC(2024, 0, 3))}>drag range</button>
      <button onClick={() => onCommit(Date.UTC(2024, 0, 2), Date.UTC(2024, 0, 3))}>
        commit range
      </button>
      <button onClick={() => onCommit(null, null)}>clear range</button>
    </div>
  ),
}));
jest.mock("../../../components/mapSearchIndex", () => ({
  fetchMapSearchIndex: (...args: unknown[]) => fetchIndex(...args),
  getMapPhotoHref: (album: string, photo: { id: string }) => `/album/${album}#${photo.id}`,
  getNextBuildId: () => buildId,
  hasMapCoordinates: (block: { kind: string; valid?: boolean }) =>
    block.kind === "photo" && block.valid !== false,
}));
jest.mock("../../../util/dms2deg", () => ({
  getDegLatLngFromExif: ({ GPSLatitude }: { GPSLatitude?: number[] }) =>
    GPSLatitude ? { decLat: 1, decLng: 2 } : { decLat: undefined, decLng: undefined },
}));

import WorldMap, { getStaticProps } from "../../../pages/map";

const { getAlbums } = jest.requireMock("../../../services/album") as { getAlbums: jest.Mock };

const photos = [
  {
    album: "trip",
    src: { src: "/one.jpg", width: 10, height: 10 },
    decLat: 1,
    decLng: 2,
    date: "2024-01-02T12:00:00",
    href: "/album/trip#one",
  },
  {
    album: "trip",
    src: { src: "/two.jpg", width: 10, height: 10 },
    decLat: 2,
    decLng: 3,
    date: "2024-01-03T12:00:00",
    href: "/album/trip#two",
  },
  {
    album: "solo",
    src: { src: "/three.jpg", width: 10, height: 10 },
    date: null,
    href: "/album/solo#three",
  },
];

describe("map page boundaries", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    query = {};
    buildId = "build-1";
    replace.mockReset();
    fetchIndex.mockReset().mockResolvedValue(new Map());
    mapProps.mockClear();
    window.history.replaceState({}, "", "/map");
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("syncs, drags, commits, and clears URL date ranges", () => {
    query = { from: "2024-01-01", to: "2024-01-04", filter_album: "trip" };
    window.history.replaceState({}, "", "/map?lat=1&lon=2&zoom=4&keep=yes");
    const { unmount } = render(<WorldMap photos={photos as never} />);

    expect(screen.getByText(/2-photo journey/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide date controls" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose dates" }));
    fireEvent.click(screen.getByRole("button", { name: "drag range" }));
    fireEvent.click(screen.getByRole("button", { name: "commit range" }));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(replace).toHaveBeenLastCalledWith(
      {
        query: {
          lat: "1",
          lon: "2",
          zoom: "4",
          keep: "yes",
          from: "2024-01-02",
          to: "2024-01-03",
        },
      },
      undefined,
      { shallow: true },
    );
    fireEvent.click(screen.getByRole("button", { name: "clear range" }));
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(replace).toHaveBeenLastCalledWith(
      { query: { lat: "1", lon: "2", zoom: "4", keep: "yes" } },
      undefined,
      { shallow: true },
    );

    fireEvent.click(screen.getByRole("button", { name: "commit range" }));
    unmount();
  });

  it("loads the search index lazily, prevents duplicate loads, and filters results", async () => {
    let resolveIndex!: (index: Map<string, string>) => void;
    fetchIndex.mockReturnValueOnce(
      new Promise<Map<string, string>>((resolve) => {
        resolveIndex = resolve;
      }),
    );
    const inputRender = render(<WorldMap photos={photos as never} />);
    const input = screen.getByRole("searchbox");

    fireEvent.change(input, { target: { value: "   " } });
    expect(fetchIndex).not.toHaveBeenCalled();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "trip" } });
    expect(fetchIndex).toHaveBeenCalledTimes(1);
    expect(input).toHaveAttribute("aria-busy", "true");

    await act(async () => resolveIndex(new Map([["/album/trip#one", "trip"]])));
    await waitFor(() => expect(input).toHaveAttribute("aria-busy", "false"));
    fireEvent.focus(input);
    expect(fetchIndex).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/photos$/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "nothing-matches" } });
    expect(screen.getByText("No photos match “nothing-matches”.")).toBeInTheDocument();
    inputRender.unmount();
  });

  it("distinguishes search matches excluded by the chosen dates", async () => {
    query = { from: "2030-01-01", to: "2030-01-02" };
    render(<WorldMap photos={photos as never} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "trip" } });
    await waitFor(() =>
      expect(screen.getByText("No matching photos in these dates.")).toBeInTheDocument(),
    );
  });

  it("shows unavailable search, retries, and handles a rejected retry", async () => {
    buildId = null;
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    render(<WorldMap photos={photos as never} />);
    const input = screen.getByRole("searchbox");
    fireEvent.focus(input);
    expect(screen.getByRole("status")).toHaveTextContent("Search unavailable");

    buildId = "retry-build";
    fetchIndex.mockRejectedValueOnce("network down");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetchIndex).toHaveBeenCalledWith("retry-build"));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Failed to progressively load map search", "network down"),
    );
    error.mockRestore();
  });

  it("toggles controls with non-string route values and resets routes when none remain", () => {
    query = { filter_album: ["trip"], lat: "1", from: "invalid", to: "invalid" };
    const { rerender } = render(<WorldMap photos={photos as never} />);
    expect(mapProps).toHaveBeenLastCalledWith(expect.objectContaining({ fitToPhotos: false }));

    const journeys = screen.getByRole("button", { name: "Show 1 journeys" });
    fireEvent.click(journeys);
    expect(journeys).toHaveTextContent("Hide journeys");
    rerender(<WorldMap photos={[]} />);
    expect(screen.getByRole("button", { name: "Choose dates" })).toBeInTheDocument();
  });

  it("serialises map photo data at build time", async () => {
    getAlbums.mockResolvedValue([
      {
        _build: { slug: "trip" },
        blocks: [
          {
            kind: "photo",
            id: "colour.jpg",
            data: { src: "colour.jpg" },
            _build: {
              srcset: [{ src: "/colour.jpg", width: 10, height: 10 }],
              exif: { GPSLatitude: [1], DateTimeOriginal: "2024-01-01" },
              tags: { colors: [[1, 2, 3]] },
              height: 10,
              width: 20,
            },
          },
          {
            kind: "photo",
            id: "plain.jpg",
            data: { src: "plain.jpg" },
            _build: { tags: {} },
          },
          { kind: "photo", id: "ignored.jpg", valid: false, _build: {} },
          { kind: "text", id: "intro" },
        ],
      },
    ]);

    await expect(getStaticProps({} as never)).resolves.toEqual({
      props: {
        photos: [
          expect.objectContaining({
            album: "trip",
            src: { src: "/colour.jpg", width: 10, height: 10 },
            date: "2024-01-01",
            placeholderColor: "rgba(1, 2, 3, 1)",
            placeholderHeight: 10,
            placeholderWidth: 20,
          }),
          expect.objectContaining({
            album: "trip",
            src: undefined,
            date: null,
            placeholderColor: "transparent",
          }),
        ],
      },
    });
  });
});
