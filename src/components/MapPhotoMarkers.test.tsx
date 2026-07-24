/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PhotoWithStyle } from "./mapWorldViewModel";
import { MapPhotoMarkers } from "./MapPhotoMarkers";

type PointHit = { id: string; at: { lng: number; lat: number } };

type DataLayerCall = {
  id: string;
  order?: number;
  points: {
    id: string;
    at: { lng: number; lat: number };
    color?: string;
    radius?: number;
    opacity?: number;
  }[];
  stroke?: { color: string; width: number };
  onPointClick?: (point: PointHit) => void;
  onPointHover?: (point: PointHit | null) => void;
};

const stopPropagation = jest.fn();
const dataLayer = jest.fn();

// The map port is replaced wholesale: jsdom has no WebGL, and what this
// component owes the map is the shape of what it hands over — one data layer
// for bulk pins, DOM markers only when a thumbnail has to load.
jest.mock("./map", () => ({
  Marker: ({
    children,
    onClick,
  }: {
    children?: ReactNode;
    onClick?: (event: { originalEvent: { stopPropagation: () => void } }) => void;
  }) => (
    <button
      type="button"
      aria-label="Map marker"
      data-testid="marker"
      onClick={() => {
        onClick?.({ originalEvent: { stopPropagation } });
      }}
    >
      {children}
    </button>
  ),
  DataLayer: (props: DataLayerCall) => {
    dataLayer(props);
    return <div data-testid={props.id} />;
  },
}));

const dataLayerCalls = (): DataLayerCall[] =>
  dataLayer.mock.calls.map((call) => call[0] as DataLayerCall);

/** The most recent render of one data layer, by the id it was given. */
const layer = (id: string): DataLayerCall => {
  const call = dataLayerCalls()
    .filter((props) => props.id === id)
    .at(-1);
  if (!call) {
    throw new Error(`no "${id}" data layer was rendered`);
  }

  return call;
};

const lastDataLayer = (): DataLayerCall => layer("photo-markers");

/** Reports the pointer as coarse (or not), the way a touch device would. */
const setCoarsePointer = (coarse: boolean) => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
};

const photo = (overrides: Partial<PhotoWithStyle> = {}): PhotoWithStyle => ({
  album: "kansai",
  src: { src: "/photo.jpg", width: 100, height: 100 },
  decLat: 35.6762,
  decLng: 139.6503,
  date: "2024-01-02T03:04:05",
  href: "/album/kansai#photo.jpg",
  relative: 0.5,
  markerColor: "red",
  ...overrides,
});

describe("MapPhotoMarkers", () => {
  let intersectionCallback: IntersectionObserverCallback;
  const observe = jest.fn();
  const unobserve = jest.fn();
  const disconnect = jest.fn();

  beforeEach(() => {
    stopPropagation.mockClear();
    dataLayer.mockClear();
    observe.mockClear();
    unobserve.mockClear();
    disconnect.mockClear();
    setCoarsePointer(false);
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: jest.fn((callback: IntersectionObserverCallback) => {
        intersectionCallback = callback;
        return { observe, unobserve, disconnect };
      }),
    });
  });

  // Plain pins: the whole set is handed to the map as data and drawn in one
  // GPU pass, rather than costing a DOM node (and a reprojection per frame)
  // each.
  describe("without marker images", () => {
    it("draws every located photo as one data layer instead of a marker each", () => {
      render(
        <MapPhotoMarkers
          photos={[photo({ href: "one", relative: 0.5 }), photo({ href: "two", decLng: 140 })]}
          visiblePhotos={[photo({ href: "one", relative: 0.5 })]}
          showMarkerImages={false}
          emphasiseRoute={false}
          activeRouteHrefSet={new Set()}
          onSelect={jest.fn()}
          onHover={jest.fn()}
        />,
      );

      expect(screen.queryAllByTestId("marker")).toHaveLength(0);
      expect(screen.getByTestId("photo-markers")).toBeTruthy();
      // The map clips what is off-screen itself, so the layer is given every
      // photo rather than a bounds-filtered set rebuilt on every pan.
      expect(lastDataLayer().points).toEqual([
        {
          id: "one",
          at: { lng: 139.6503, lat: 35.6762 },
          color: "red",
          radius: 7,
          opacity: 0.9,
        },
        {
          id: "two",
          at: { lng: 140, lat: 35.6762 },
          color: "red",
          radius: 7,
          opacity: 0.9,
        },
      ]);
      // The DOM pin's white ring, kept so pale markers stay legible on a light
      // basemap.
      expect(lastDataLayer().stroke).toEqual({ color: "rgba(255, 255, 255, 0.84)", width: 2 });
      expect(IntersectionObserver).not.toHaveBeenCalled();
    });

    it("keeps photos selectable and hoverable through the layer", () => {
      const onSelect = jest.fn();
      const onHover = jest.fn();
      const currentPhoto = photo();

      render(
        <MapPhotoMarkers
          photos={[currentPhoto]}
          visiblePhotos={[currentPhoto]}
          showMarkerImages={false}
          emphasiseRoute={false}
          activeRouteHrefSet={new Set()}
          onSelect={onSelect}
          onHover={onHover}
        />,
      );

      const at = { lng: 139.6503, lat: 35.6762 };
      act(() => {
        lastDataLayer().onPointHover?.({ id: currentPhoto.href, at });
        lastDataLayer().onPointClick?.({ id: currentPhoto.href, at });
        lastDataLayer().onPointHover?.(null);
      });

      expect(onSelect).toHaveBeenCalledWith(currentPhoto);
      expect(onHover.mock.calls).toEqual([[currentPhoto], [null]]);
    });

    it("ignores a hit on a point it no longer knows about", () => {
      const onSelect = jest.fn();
      const onHover = jest.fn();

      render(
        <MapPhotoMarkers
          photos={[photo()]}
          visiblePhotos={[photo()]}
          showMarkerImages={false}
          emphasiseRoute={false}
          activeRouteHrefSet={new Set()}
          onSelect={onSelect}
          onHover={onHover}
        />,
      );

      act(() => {
        lastDataLayer().onPointClick?.({ id: "stale", at: { lng: 0, lat: 0 } });
        lastDataLayer().onPointHover?.({ id: "stale", at: { lng: 0, lat: 0 } });
      });

      expect(onSelect).not.toHaveBeenCalled();
      expect(onHover).toHaveBeenCalledWith(null);
    });

    it("fades photos off the emphasised route", () => {
      render(
        <MapPhotoMarkers
          photos={[photo({ href: "active" }), photo({ href: "inactive", decLng: 140 })]}
          visiblePhotos={[]}
          showMarkerImages={false}
          emphasiseRoute
          activeRouteHrefSet={new Set(["active"])}
          onSelect={jest.fn()}
          onHover={jest.fn()}
        />,
      );

      expect(lastDataLayer().points.map((point) => [point.id, point.opacity])).toEqual([
        ["active", 1],
        ["inactive", 0.28],
      ]);
    });

    it("omits photos without complete coordinates", () => {
      render(
        <MapPhotoMarkers
          photos={[photo({ decLat: null }), photo({ href: "valid", date: null })]}
          visiblePhotos={[]}
          showMarkerImages={false}
          emphasiseRoute={false}
          activeRouteHrefSet={new Set()}
          onSelect={jest.fn()}
          onHover={jest.fn()}
        />,
      );

      expect(lastDataLayer().points.map((point) => point.id)).toEqual(["valid"]);
    });

    it("draws the pins above the layers below them and their tap targets below the pins", () => {
      setCoarsePointer(true);
      render(
        <MapPhotoMarkers
          photos={[photo()]}
          visiblePhotos={[photo()]}
          showMarkerImages={false}
          emphasiseRoute={false}
          activeRouteHrefSet={new Set()}
          order={40}
          onSelect={jest.fn()}
          onHover={jest.fn()}
        />,
      );

      expect(layer("photo-markers").order).toBe(40);
      expect(layer("photo-marker-targets").order).toBe(39);
    });

    // A drawn point is hit-tested at the size it is drawn: 7px of radius plus a
    // 2px ring is an 18px target, well under the 44px minimum the DOM pin buys
    // itself with an invisible expander on coarse pointers.
    describe("on a coarse pointer", () => {
      it("offers a 44px transparent tap target that owns the interactions", () => {
        setCoarsePointer(true);
        const onSelect = jest.fn();
        const onHover = jest.fn();
        const currentPhoto = photo();

        render(
          <MapPhotoMarkers
            photos={[currentPhoto]}
            visiblePhotos={[currentPhoto]}
            showMarkerImages={false}
            emphasiseRoute={false}
            activeRouteHrefSet={new Set()}
            onSelect={onSelect}
            onHover={onHover}
          />,
        );

        const targets = layer("photo-marker-targets");
        expect(targets.points).toEqual([
          { id: currentPhoto.href, at: { lng: 139.6503, lat: 35.6762 }, radius: 22, opacity: 0 },
        ]);

        // Only one layer may report the tap: two would read as two taps, which
        // is how a stacked location cycles past the photo that was aimed at.
        expect(lastDataLayer().onPointClick).toBeUndefined();
        expect(lastDataLayer().onPointHover).toBeUndefined();

        act(() => {
          targets.onPointClick?.({ id: currentPhoto.href, at: { lng: 0, lat: 0 } });
        });
        expect(onSelect).toHaveBeenCalledWith(currentPhoto);
      });

      it("leaves a fine pointer with no target layer at all", () => {
        render(
          <MapPhotoMarkers
            photos={[photo()]}
            visiblePhotos={[photo()]}
            showMarkerImages={false}
            emphasiseRoute={false}
            activeRouteHrefSet={new Set()}
            onSelect={jest.fn()}
            onHover={jest.fn()}
          />,
        );

        expect(screen.queryByTestId("photo-marker-targets")).toBeNull();
        expect(lastDataLayer().onPointClick).toBeDefined();
      });
    });

    // Drawn points are pixels on a canvas: nothing to focus, nothing to
    // announce. Without this the world map — the default view — has no keyboard
    // or screen-reader route to a photo at all.
    describe("keyboard and screen-reader access", () => {
      it("offers the photos in view as focusable controls wired to the pins' handlers", () => {
        const onSelect = jest.fn();
        const onHover = jest.fn();
        const inView = photo({ href: "in-view" });

        render(
          <MapPhotoMarkers
            photos={[inView, photo({ href: "off-screen", decLng: 140 })]}
            visiblePhotos={[inView]}
            showMarkerImages={false}
            emphasiseRoute={false}
            activeRouteHrefSet={new Set()}
            onSelect={onSelect}
            onHover={onHover}
          />,
        );

        const list = screen.getByRole("list", { name: "Photos in view" });
        const control = screen.getByRole("button", { name: "Photo from kansai on 2 Jan 2024" });
        expect(list).toContainElement(control);

        // Focusing shows the photo's popup on the map, which is the visible
        // feedback a sighted keyboard user gets in place of a hover.
        fireEvent.focus(control);
        expect(onHover).toHaveBeenCalledWith(inView);
        fireEvent.blur(control);
        expect(onHover).toHaveBeenLastCalledWith(null);

        fireEvent.click(control);
        expect(onSelect).toHaveBeenCalledWith(inView);
      });

      it("caps the list and says how to reach the rest", () => {
        const photos = Array.from({ length: 42 }, (_, index) =>
          photo({ href: `photo-${index}`, decLng: index }),
        );
        render(
          <MapPhotoMarkers
            photos={photos}
            visiblePhotos={photos}
            showMarkerImages={false}
            emphasiseRoute={false}
            activeRouteHrefSet={new Set()}
            onSelect={jest.fn()}
            onHover={jest.fn()}
          />,
        );

        // Reinstating a control per photo is the cost the drawn layer exists to
        // avoid, so the list is capped rather than complete.
        expect(screen.getAllByRole("button", { name: /Photo from kansai/ })).toHaveLength(40);
        expect(screen.getByText("Zoom in to reach the other 2 photos in view.")).toBeTruthy();
      });

      it("says nothing when the viewport holds no photos", () => {
        render(
          <MapPhotoMarkers
            photos={[photo()]}
            visiblePhotos={[]}
            showMarkerImages={false}
            emphasiseRoute={false}
            activeRouteHrefSet={new Set()}
            onSelect={jest.fn()}
            onHover={jest.fn()}
          />,
        );

        expect(screen.queryByRole("list", { name: "Photos in view" })).toBeNull();
      });
    });
  });

  // Rich pins: a lazily loaded thumbnail needs a real element to observe, so
  // this set stays on DOM markers. It is always small.
  describe("with marker images", () => {
    it("supports pointer, focus, and keyboard selection", () => {
      const onSelect = jest.fn();
      const onHover = jest.fn();
      const currentPhoto = photo();

      render(
        <MapPhotoMarkers
          photos={[currentPhoto]}
          visiblePhotos={[currentPhoto]}
          showMarkerImages
          emphasiseRoute={false}
          activeRouteHrefSet={new Set()}
          onSelect={onSelect}
          onHover={onHover}
        />,
      );

      expect(dataLayer).not.toHaveBeenCalled();
      const control = screen.getByRole("button", { name: "Photo from kansai on 2 Jan 2024" });
      fireEvent.mouseOver(control);
      fireEvent.mouseLeave(control);
      fireEvent.focus(control);
      fireEvent.keyDown(control, { key: "ArrowDown" });
      fireEvent.keyDown(control, { key: "Enter" });
      fireEvent.keyDown(control, { key: " " });
      fireEvent.click(screen.getByTestId("marker"));

      expect(onHover.mock.calls).toEqual([[currentPhoto], [null], [currentPhoto]]);
      expect(onSelect).toHaveBeenCalledTimes(3);
      // Clicking a pin must not also read as a click on the map beneath it.
      expect(stopPropagation).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledTimes(1);
    });

    it("gives a marker only to the photos in view", () => {
      render(
        <MapPhotoMarkers
          photos={[photo({ href: "one" }), photo({ href: "two", decLng: 140 })]}
          visiblePhotos={[photo({ href: "one" })]}
          showMarkerImages
          emphasiseRoute={false}
          activeRouteHrefSet={new Set()}
          onSelect={jest.fn()}
          onHover={jest.fn()}
        />,
      );

      // A DOM node each is only affordable for what can actually be seen.
      expect(screen.getAllByTestId("marker")).toHaveLength(1);
    });

    it("shares one intersection observer between marker images", () => {
      const photos = [photo({ href: "one" }), photo({ href: "two", decLng: 140 })];
      const { container } = render(
        <MapPhotoMarkers
          photos={photos}
          visiblePhotos={photos}
          showMarkerImages
          emphasiseRoute={false}
          activeRouteHrefSet={new Set()}
          onSelect={jest.fn()}
          onHover={jest.fn()}
        />,
      );

      expect(IntersectionObserver).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledTimes(2);
      expect(container.querySelectorAll("img")).toHaveLength(0);

      const targets = observe.mock.calls.map(([target]) => target as Element);
      act(() => {
        intersectionCallback(
          targets.map(
            (target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry,
          ),
          {} as IntersectionObserver,
        );
      });

      expect(container.querySelectorAll("img")).toHaveLength(2);
    });

    it("marks route members active and other photos muted", () => {
      const photos = [photo({ href: "active" }), photo({ href: "inactive", decLng: 140 })];
      render(
        <MapPhotoMarkers
          photos={photos}
          visiblePhotos={photos}
          showMarkerImages
          emphasiseRoute
          activeRouteHrefSet={new Set(["active"])}
          onSelect={jest.fn()}
          onHover={jest.fn()}
        />,
      );

      const controls = screen.getAllByRole("button", { name: /Photo from kansai/ });
      expect(controls[0]?.className).toContain("pinActive");
      expect(controls[1]?.className).toContain("pinMuted");
    });

    it("omits photos without complete coordinates", () => {
      const photos = [photo({ decLat: null }), photo({ href: "valid", date: null })];
      render(
        <MapPhotoMarkers
          photos={photos}
          visiblePhotos={photos}
          showMarkerImages
          emphasiseRoute={false}
          activeRouteHrefSet={new Set()}
          onSelect={jest.fn()}
          onHover={jest.fn()}
        />,
      );

      expect(screen.getAllByTestId("marker")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Photo from kansai" })).toBeTruthy();
    });

    it("shows a preview marker's thumbnail once visible even below the marker-image zoom threshold", () => {
      // Small, spread-out result sets auto-fit far below the zoom threshold that
      // drives showMarkerImages, so previewMarkers is the only signal available —
      // it must still take the DOM-marker path and reveal the thumbnail.
      const { container } = render(
        <MapPhotoMarkers
          photos={[photo()]}
          visiblePhotos={[photo()]}
          showMarkerImages={false}
          previewMarkers
          emphasiseRoute={false}
          activeRouteHrefSet={new Set()}
          onSelect={jest.fn()}
          onHover={jest.fn()}
        />,
      );

      expect(dataLayer).not.toHaveBeenCalled();
      expect(observe).toHaveBeenCalledTimes(1);
      expect(container.querySelectorAll("img")).toHaveLength(0);

      const target = observe.mock.calls[0]![0] as Element;
      act(() => {
        intersectionCallback(
          [{ target, isIntersecting: true } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });

      expect(container.querySelectorAll("img")).toHaveLength(1);
    });
  });
});
