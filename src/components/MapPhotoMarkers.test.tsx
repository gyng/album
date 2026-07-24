/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import React, { type ReactNode } from "react";
import type { PhotoWithStyle } from "./mapWorldViewModel";
import { KEYBOARD_LIST_LIMIT, MapPhotoMarkers } from "./MapPhotoMarkers";
import { MapContext } from "./map/adapters/maplibre/context";
import { Popup as AdapterPopup } from "./map/adapters/maplibre/Popup";
import type { MapRef } from "./map/adapters/maplibre/types";

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

/**
 * Only `gl.Popup` is needed: the map port itself is mocked above, so the one
 * piece of real map code these tests run is the MapLibre popup adapter — the
 * seam where a popup opening decides what happens to the reader's focus.
 *
 * `addTo` reproduces what MapLibre does: the content goes into the document,
 * and then, unless `focusAfterOpen` says otherwise (it defaults to true), focus
 * moves to the first focusable element inside it. The selector is verbatim from
 * `maplibre-gl-dev.mjs` (`focusQuerySelector`, beside `_focusFirstElement`).
 */
jest.mock("./map/adapters/maplibre/engine", () => {
  const FOCUS_QUERY = [
    "a[href]",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable]:not([contenteditable='false'])",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
  ].join(", ");

  class PopupMock {
    options: Record<string, unknown>;
    open = false;
    content: HTMLElement | null = null;
    lngLat: [number, number] = [0, 0];
    listeners = new Map<string, Set<(event: unknown) => void>>();

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
    }

    on(type: string, listener: (event: unknown) => void): this {
      const registered = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
      registered.add(listener);
      this.listeners.set(type, registered);

      return this;
    }
    off(type: string, listener: (event: unknown) => void): this {
      this.listeners.get(type)?.delete(listener);

      return this;
    }
    setDOMContent(content: HTMLElement): this {
      this.content = content;

      return this;
    }
    addTo(): this {
      this.open = true;
      if (this.content) {
        document.body.append(this.content);
      }
      if (this.options.focusAfterOpen !== false) {
        this.content?.querySelector<HTMLElement>(FOCUS_QUERY)?.focus();
      }

      return this;
    }
    remove(): this {
      this.open = false;
      this.content?.remove();

      return this;
    }
    isOpen(): boolean {
      return this.open;
    }
    setLngLat(lngLat: [number, number]): this {
      this.lngLat = lngLat;

      return this;
    }
    getLngLat(): { lng: number; lat: number } {
      return { lng: this.lngLat[0], lat: this.lngLat[1] };
    }
    setOffset(): this {
      return this;
    }
    setMaxWidth(): this {
      return this;
    }
    addClassName(): void {}
    removeClassName(): void {}
  }

  return { gl: { Popup: PopupMock } };
});

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

/** Answers the pointer media queries the way a device with these would. */
const setPointerQueries = (matching: string[]) => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: matching.includes(query),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
};

/** A phone, or a mouse-only desktop: one pointer, and it is the primary one. */
const setCoarsePointer = (coarse: boolean) => {
  setPointerQueries(
    coarse
      ? ["(pointer: coarse)", "(any-pointer: coarse)"]
      : ["(pointer: fine)", "(any-pointer: fine)"],
  );
};

/** A touchscreen laptop: the mouse is primary, but a fingertip is still a pointer. */
const setHybridPointer = () => {
  setPointerQueries(["(pointer: fine)", "(any-pointer: fine)", "(any-pointer: coarse)"]);
};

/**
 * A media-query list that can be followed, as a browser's can: it starts fine,
 * and `setCoarse` moves it the way a device gaining or losing a pointer does.
 */
const setSubscribablePointer = () => {
  const listeners = new Set<() => void>();
  const query = {
    matches: false,
    addEventListener: jest.fn((_type: string, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: jest.fn((_type: string, listener: () => void) => {
      listeners.delete(listener);
    }),
  };
  window.matchMedia = jest.fn(() => query) as unknown as typeof window.matchMedia;

  return {
    query,
    setCoarse: (coarse: boolean) => {
      query.matches = coarse;
      act(() => {
        listeners.forEach((listener) => {
          listener();
        });
      });
    },
  };
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

      it("follows the pointer changing under it, and stops following on unmount", () => {
        // A tablet's keyboard cover coming off, or a phone gaining a mouse: the
        // reader does not remount the map to tell us, so the query is followed.
        const pointer = setSubscribablePointer();
        const { unmount } = render(
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

        pointer.setCoarse(true);
        expect(layer("photo-marker-targets").points).toHaveLength(1);

        pointer.setCoarse(false);
        expect(screen.queryByTestId("photo-marker-targets")).toBeNull();

        unmount();
        expect(pointer.query.removeEventListener).toHaveBeenCalledWith(
          "change",
          expect.any(Function),
        );
      });

      it("reads a media-query list it cannot subscribe to and leaves it there", () => {
        // Not every environment hands back something subscribable — an older
        // Safari, or a test double. The one reading still has to be honoured,
        // and subscribing to what has no subscription must not throw.
        window.matchMedia = jest.fn(() => ({
          matches: true,
        })) as unknown as typeof window.matchMedia;

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

        expect(layer("photo-marker-targets").points).toHaveLength(1);
      });

      it("counts a touchscreen laptop as coarse even though its mouse is primary", () => {
        // `pointer` reports the *primary* pointer only, so a hybrid device says
        // `fine` and its touch users would be left tapping at an 18px dot.
        setHybridPointer();
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

        expect(layer("photo-marker-targets").points).toHaveLength(1);
      });

      // The targets are a second source, a second tiling pass and a second draw
      // — on the hardware least able to afford one. They are kept to what the
      // map is actually showing, and dropped once a 44px circle stops telling
      // one pin from another.
      it("lays targets over the photos in view rather than the whole world", () => {
        setCoarsePointer(true);
        const inView = photo({ href: "in-view" });
        render(
          <MapPhotoMarkers
            photos={[inView, photo({ href: "off-screen", decLng: 140 })]}
            visiblePhotos={[inView]}
            showMarkerImages={false}
            emphasiseRoute={false}
            activeRouteHrefSet={new Set()}
            onSelect={jest.fn()}
            onHover={jest.fn()}
          />,
        );

        expect(layer("photo-marker-targets").points.map((point) => point.id)).toEqual(["in-view"]);
        // The drawn pins still take the whole set: the map clips them itself.
        expect(layer("photo-markers").points).toHaveLength(2);
      });

      it("drops the targets once the view is too dense for them to mean anything", () => {
        setCoarsePointer(true);
        const photos = Array.from({ length: 181 }, (_, index) =>
          photo({ href: `photo-${index}`, decLng: index / 10 }),
        );
        const onSelect = jest.fn();
        render(
          <MapPhotoMarkers
            photos={photos}
            visiblePhotos={photos}
            showMarkerImages={false}
            emphasiseRoute={false}
            activeRouteHrefSet={new Set()}
            onSelect={onSelect}
            onHover={jest.fn()}
          />,
        );

        expect(screen.queryByTestId("photo-marker-targets")).toBeNull();
        // With no target layer the pins take the interactions back, so a tap
        // still reaches a photo — the pins are shoulder to shoulder by now.
        act(() => {
          lastDataLayer().onPointClick?.({ id: "photo-7", at: { lng: 0.7, lat: 35.6762 } });
        });
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ href: "photo-7" }));
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

      it("caps the list and says how to reach the rest before the entries, not after", () => {
        const total = KEYBOARD_LIST_LIMIT + 2;
        const photos = Array.from({ length: total }, (_, index) =>
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
        expect(screen.getAllByRole("button", { name: /Photo from kansai/ })).toHaveLength(
          KEYBOARD_LIST_LIMIT,
        );
        const notice = screen.getByText(
          `Showing the first ${KEYBOARD_LIST_LIMIT} of ${total} photos in view. Zoom in to reach the rest.`,
        );
        // After the entries the notice is unreachable in practice: it would only
        // find someone who had already traversed forty photos whose names are
        // frequently identical, which is exactly who needs to be told sooner.
        const items = screen.getAllByRole("listitem");
        expect(items[0]).toBe(notice);
      });

      /**
       * The list as the map actually assembles it: a popup for whatever is
       * hovered or focused — the real MapLibre popup adapter, against the engine
       * fake above — rendered alongside the pins, exactly as `MapWorld` does.
       */
      const KeyboardMap = ({
        photos,
        visiblePhotos,
        onSelect,
      }: {
        photos: PhotoWithStyle[];
        visiblePhotos: PhotoWithStyle[];
        onSelect: (photo: PhotoWithStyle) => void;
      }) => {
        const [hovered, setHovered] = React.useState<PhotoWithStyle | null>(null);

        return (
          <MapContext.Provider value={{ map: {} as unknown as MapRef }}>
            {hovered ? (
              <AdapterPopup longitude={hovered.decLng ?? 0} latitude={hovered.decLat ?? 0}>
                <a href={hovered.href}>{hovered.album}</a>
              </AdapterPopup>
            ) : null}
            <MapPhotoMarkers
              photos={photos}
              visiblePhotos={visiblePhotos}
              showMarkerImages={false}
              emphasiseRoute={false}
              activeRouteHrefSet={new Set()}
              onSelect={onSelect}
              onHover={setHovered}
            />
          </MapContext.Provider>
        );
      };

      /** Moves focus the way Tab does: on to the next focusable element. */
      const tab = () => {
        const focusable = [
          ...document.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
        ];
        const next = focusable.indexOf(document.activeElement as HTMLElement) + 1;
        act(() => {
          focusable[next === focusable.length ? 0 : next]?.focus();
        });
      };

      it("tabs from one entry to the next, and the second one can be activated", () => {
        const onSelect = jest.fn();
        const photos = [
          photo({ href: "one" }),
          photo({ href: "two", album: "kyushu", decLng: 140 }),
        ];
        render(<KeyboardMap photos={photos} visiblePhotos={photos} onSelect={onSelect} />);

        const first = screen.getByRole("button", { name: "Photo from kansai on 2 Jan 2024" });
        const second = screen.getByRole("button", { name: "Photo from kyushu on 2 Jan 2024" });

        tab();
        expect(document.activeElement).toBe(first);
        // Focusing an entry opens that photo's popup, which is the visible
        // feedback a sighted keyboard user gets in place of a hover — and the
        // popup must not take the focus that opened it, or the entry blurs, the
        // popup unmounts with the state that held it, and the reader is left on
        // <body> with the traverse back at the top of the document.
        expect(screen.getByRole("link", { name: "kansai" })).toBeTruthy();

        tab();
        expect(document.activeElement).toBe(second);
        expect(screen.getByRole("link", { name: "kyushu" })).toBeTruthy();

        // Enter and Space are a real button's job, so the entry has to be one.
        expect(second.tagName).toBe("BUTTON");
        fireEvent.click(second);
        expect(onSelect).toHaveBeenCalledWith(photos[1]);
      });

      it("keeps the entry under the reader's focus when the viewport moves", () => {
        const photos = [
          photo({ href: "one" }),
          photo({ href: "two", album: "kyushu", decLng: 140 }),
        ];
        const { rerender } = render(
          <KeyboardMap photos={photos} visiblePhotos={photos} onSelect={jest.fn()} />,
        );

        const second = screen.getByRole("button", { name: "Photo from kyushu on 2 Jan 2024" });
        act(() => {
          second.focus();
        });

        // The cinematic tour flies the camera on its own, and the auto-fit
        // reframes on a new result set: either can take what is in view out from
        // under a focused entry, dropping the reader to <body> unannounced.
        rerender(<KeyboardMap photos={photos} visiblePhotos={[photos[0]!]} onSelect={jest.fn()} />);

        expect(document.activeElement).toBe(second);
        expect(screen.getByRole("button", { name: "Photo from kyushu on 2 Jan 2024" })).toBe(
          second,
        );

        // Once focus leaves, the list takes up the viewport it was holding off.
        act(() => {
          second.blur();
        });
        expect(
          screen.queryByRole("button", { name: "Photo from kyushu on 2 Jan 2024" }),
        ).toBeNull();
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
