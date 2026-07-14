/**
 * @jest-environment jsdom
 */

import { act, render } from "@testing-library/react";
import type { MapWorldEntry } from "./MapWorld";
import { MapDirector } from "./MapDirector";

const flyTo = jest.fn();
const stop = jest.fn();
let currentMap: { flyTo: typeof flyTo; stop: typeof stop } | null = { flyTo, stop };

jest.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({ current: currentMap }),
}));

const photo = (overrides: Partial<MapWorldEntry> = {}): MapWorldEntry => ({
  album: "test-simple",
  src: { src: "/photo.jpg", width: 100, height: 100 },
  decLat: 1.25,
  decLng: 103.75,
  date: "2024-01-02T03:04:05",
  href: "/test-simple#photo.jpg",
  ...overrides,
});

describe("MapDirector", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    flyTo.mockClear();
    stop.mockClear();
    currentMap = { flyTo, stop };
    jest.spyOn(window, "matchMedia").mockImplementation(
      () =>
        ({
          matches: false,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("visits each photo on its cadence and stops the map on cleanup", () => {
    const onVisit = jest.fn();
    const first = photo();
    const second = photo({ href: "/test-simple#second.jpg", decLat: 2, decLng: 104 });
    const view = render(<MapDirector enabled sequence={[first, second]} onVisit={onVisit} />);

    expect(onVisit).toHaveBeenLastCalledWith(first);
    expect(flyTo).toHaveBeenLastCalledWith({
      center: [103.75, 1.25],
      zoom: 6.2,
      pitch: 42,
      bearing: -102,
      duration: 4_600,
    });

    act(() => jest.advanceTimersByTime(7_500));
    expect(onVisit).toHaveBeenLastCalledWith(second);
    expect(flyTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: [104, 2], zoom: 8.4, bearing: -49 }),
    );

    view.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(15_000));
    expect(onVisit).toHaveBeenCalledTimes(2);
  });

  it("removes motion from flights when the system requests it", () => {
    jest.mocked(window.matchMedia).mockReturnValue({
      matches: true,
    } as MediaQueryList);

    render(<MapDirector enabled sequence={[photo()]} onVisit={jest.fn()} />);

    expect(flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ bearing: 0, duration: 0, pitch: 0 }),
    );
  });

  it.each([
    { enabled: false, photos: [photo()], map: { flyTo, stop } },
    { enabled: true, photos: [] as MapWorldEntry[], map: { flyTo, stop } },
    { enabled: true, photos: [photo()], map: null },
  ])("does not start without all prerequisites", ({ enabled, photos, map }) => {
    currentMap = map;
    const onVisit = jest.fn();

    render(<MapDirector enabled={enabled} sequence={photos} onVisit={onVisit} />);

    expect(onVisit).not.toHaveBeenCalled();
    expect(flyTo).not.toHaveBeenCalled();
  });

  it("does not fly to an entry without complete coordinates", () => {
    const onVisit = jest.fn();

    render(
      <MapDirector
        enabled
        sequence={[photo({ decLat: null }), photo({ decLng: null })]}
        onVisit={onVisit}
      />,
    );

    expect(onVisit).not.toHaveBeenCalled();
    expect(flyTo).not.toHaveBeenCalled();
  });
});
