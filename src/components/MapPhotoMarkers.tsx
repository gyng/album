import { DataLayer, Marker, type PointFeature } from "./map";
import type { PhotoWithStyle } from "./mapWorldViewModel";
import { formatMapPhotoDate } from "./mapWorldViewModel";
import {
  LazyMapMarkerImage,
  type ObserveMapMarker,
  useSharedMapMarkerObserver,
} from "./MapWorldMapChildren";
import React from "react";
import styles from "./MapWorld.module.css";
import pinStyles from "./mapPin.module.css";

type MapPhotoMarkersProps = {
  /**
   * Every photo the map is drawing. The GPU layer takes the whole set: it clips
   * what is off-screen itself, so handing it a bounds-filtered set would only
   * mean rebuilding the features on every pan to save work already done free.
   */
  photos: PhotoWithStyle[];
  /**
   * The photos inside the current viewport. A DOM marker each is only affordable
   * for what can actually be seen, the keyboard list is only useful if it offers
   * what the reader is looking at, and a coarse-pointer tap target is only worth
   * laying down over a pin that is on the screen.
   */
  visiblePhotos: PhotoWithStyle[];
  showMarkerImages: boolean;
  /**
   * Preview each marker in place with its thumbnail and album, rather than
   * making you click pins to find out what matched. Only for a small result
   * set — captioning hundreds of pins buries the map under its own labels.
   */
  previewMarkers?: boolean;
  emphasiseRoute: boolean;
  activeRouteHrefSet: ReadonlySet<string>;
  /** Where the pin layers draw relative to the map's other data layers. */
  order?: number;
  onSelect: (photo: PhotoWithStyle) => void;
  onHover: (photo: PhotoWithStyle | null) => void;
};

type LocatedPhoto = PhotoWithStyle & { decLat: number; decLng: number };

const hasCoordinates = (photo: PhotoWithStyle): photo is LocatedPhoto =>
  photo.decLat !== null && photo.decLng !== null;

const photoLabel = (photo: PhotoWithStyle): string => {
  const formattedDate = formatMapPhotoDate(photo.date);

  return `Photo from ${photo.album}${formattedDate ? ` on ${formattedDate}` : ""}`;
};

/* -------------------------------------------------------------------------- */
/* Bulk pins — drawn on the GPU                                                */
/* -------------------------------------------------------------------------- */

/** Half of the 14px pin the DOM markers draw (see `mapPin.module.css`). */
const PIN_RADIUS = 7;
/** The pin's white ring, matching `.pin`'s outline shadow. */
const PIN_HALO = { color: "rgba(255, 255, 255, 0.84)", width: 2 };
/** `.pin`'s resting opacity. */
const PIN_OPACITY = 0.9;
/** `.pinActive` — the photo's own route. */
const ROUTE_ACTIVE_OPACITY = 1;
/** `.pinMuted` — everything off the emphasised route. */
const ROUTE_MUTED_OPACITY = 0.28;

/**
 * Half of the 44px minimum tap target, which the 18px drawn pin is well short
 * of. The DOM pin buys the same room with an invisible `::after` (see the
 * coarse-pointer block in `mapPin.module.css`); a drawn point has no element to
 * hang one off, so the room comes from a transparent circle of its own.
 */
const TOUCH_TARGET_RADIUS = 22;

/**
 * How many targets a screen has room for at full size.
 *
 * A 44px target covers ~1,500px² of a ~273,000px² phone viewport, so around 180
 * of them in view is where they would tile it edge to edge — past that a tap
 * lands on some pin whatever the target's size, and widening no longer decides
 * *which*. That is a total-area figure and nothing more: circles cannot tile
 * (the best packing is ~0.9069, which alone puts the uniform crossover nearer
 * 160), and photo pins are not uniformly spread — they pile up on cities, so a
 * count in view says little about the density under any particular fingertip.
 *
 * So it is not a threshold: it is where `touchTargetRadius` starts shrinking.
 */
export const TOUCH_TARGET_FULL_SIZE_COUNT = 180;

/**
 * The radius a tap target is drawn at with this many photos in view.
 *
 * Continuous on purpose. A count that switched the widening off would invert the
 * feature at its own boundary: one pan admitting the count-th photo would drop
 * every target at once, including the sparse ones at the edge of the viewport
 * that have a fingertip's worth of empty map around them and are exactly what
 * this exists for — on the hardware it exists for. Crossing such a boundary also
 * unmounts a layer mid-gesture, and `usePointInteractions` reports a leave as it
 * goes, closing the popup under the reader's thumb.
 *
 * Shrinking as the inverse square root of the count keeps each target's share of
 * the screen constant instead, so a pan changes the targets by a pixel or two
 * rather than taking them away.
 */
const touchTargetRadius = (inView: number): number =>
  inView <= TOUCH_TARGET_FULL_SIZE_COUNT
    ? TOUCH_TARGET_RADIUS
    : Math.max(PIN_RADIUS, TOUCH_TARGET_RADIUS * Math.sqrt(TOUCH_TARGET_FULL_SIZE_COUNT / inView));

/** How many of the photos in view the keyboard list offers at once. */
export const KEYBOARD_LIST_LIMIT = 40;

const pinOpacity = (photo: LocatedPhoto, emphasisedHrefs: ReadonlySet<string> | null): number => {
  if (!emphasisedHrefs) {
    return PIN_OPACITY;
  }

  return emphasisedHrefs.has(photo.href) ? ROUTE_ACTIVE_OPACITY : ROUTE_MUTED_OPACITY;
};

/**
 * Whether the reader is pointing at the map with something blunt. Read on the
 * client only — the server has no pointer, and guessing one would render a
 * layer the first paint then has to take away.
 */
const useCoarsePointer = (): boolean => {
  const [isCoarse, setIsCoarse] = React.useState(false);

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    // `any-pointer`, not `pointer`: `pointer` describes the *primary* pointer, so
    // a laptop with a touchscreen and a mouse reports `fine` and its touch users
    // would be left with the 18px target. Keep this in step with the same query
    // in `mapPin.module.css`.
    const query = window.matchMedia("(any-pointer: coarse)");
    setIsCoarse(query.matches);
    // A hybrid device can gain or lose a fine pointer mid-session, but not every
    // environment's media query list is subscribable.
    if (typeof query.addEventListener !== "function") {
      return;
    }

    const sync = () => {
      setIsCoarse(query.matches);
    };
    query.addEventListener("change", sync);

    return () => {
      query.removeEventListener("change", sync);
    };
  }, []);

  return isCoarse;
};

/**
 * Keyboard and screen-reader access to pins that have no element of their own.
 *
 * Drawn points cannot be focused or announced: there is nothing there but
 * pixels. So the photos in view are offered again as ordinary buttons, hidden
 * from sight because the map already shows them, and wired to the same select
 * and hover handlers the pins use — focusing one opens its popup on the map,
 * which is the visible feedback a sighted keyboard user needs.
 *
 * The list is capped rather than complete: reinstating a node per photo is the
 * ~1400-element cost the drawn layer exists to avoid, and a tab-through of
 * hundreds of identical-sounding photos would not be usable anyway. Zooming in
 * narrows the view, and with it this list.
 */
const MapPhotoKeyboardList = ({
  photos,
  available,
  onSelect,
  onHover,
}: {
  photos: LocatedPhoto[];
  /**
   * Every photo the map still has, by href — not just the ones in view. The
   * hold below is over the camera, and this is what tells a photo the camera
   * has left behind from one the data no longer contains.
   */
  available: ReadonlyMap<string, LocatedPhoto>;
  onSelect: (photo: PhotoWithStyle) => void;
  onHover: (photo: PhotoWithStyle | null) => void;
}) => {
  // What is in view is recomputed from the camera, so a pan — the auto-fit, or
  // the cinematic tour flying off on its own — can take the entry the reader is
  // standing on out from under them, dropping focus to `<body>` with nothing
  // announced and the traverse back at the top of the document. While focus is
  // anywhere in the list, the list it is reading holds still; the new viewport
  // is taken up the moment focus leaves.
  //
  // Held by href rather than by value, and resolved through the photos the map
  // still has: what is in view also changes when the *data* does — a search, the
  // time-range slider, an album filter — and a photo the map has dropped is not
  // one the camera merely moved away from. Holding it would go on announcing a
  // photo that is no longer on the map, and activating it would select something
  // the screen reconciles away again the moment it arrives: a control that does
  // nothing visible, having stopped the cinematic tour on its way.
  const [heldHrefs, setHeldHrefs] = React.useState<readonly string[] | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const listed = React.useMemo(
    () =>
      heldHrefs
        ? heldHrefs.flatMap((href) => {
            const photo = available.get(href);

            return photo ? [photo] : [];
          })
        : photos,
    [available, heldHrefs, photos],
  );

  if (listed.length === 0) {
    return null;
  }

  const offered = listed.slice(0, KEYBOARD_LIST_LIMIT);

  return (
    <ul ref={listRef} className={styles.keyboardPins} aria-label="Photos in view">
      {/* Ahead of the entries, not after them: read as the last item it would
          only reach someone who had already tabbed past forty photos whose
          names are frequently identical, which is precisely who it is for. */}
      {listed.length > offered.length ? (
        <li>{`Showing the first ${offered.length} of ${listed.length} photos in view. Zoom in to reach the rest.`}</li>
      ) : null}
      {offered.map((photo) => (
        <li key={photo.href}>
          {/* A real button, so Enter and Space activate it without this having
              to reimplement what a button already does. */}
          <button
            type="button"
            onClick={() => {
              onSelect(photo);
            }}
            onFocus={() => {
              onHover(photo);
              setHeldHrefs((current) => current ?? photos.map((inView) => inView.href));
            }}
            onBlur={(event) => {
              onHover(null);
              // Moving between entries is not leaving: the list only takes up
              // the new viewport once focus has gone somewhere else entirely.
              const next = event.relatedTarget;
              if (next instanceof Node) {
                if (!listRef.current?.contains(next)) {
                  setHeldHrefs(null);
                }

                return;
              }

              // No `relatedTarget` is ambiguous. Focus may have gone nowhere —
              // or the *window* may have lost it, to another application, a tab,
              // or the devtools, which fires `focusout` with nothing to point at
              // while this entry stays the document's active element. Releasing
              // then would rebuild the list under a still-focused entry and
              // strand the reader on `<body>` when they came back, which is
              // precisely what the hold exists to stop. So where focus actually
              // is decides it, rather than what the event says about where it
              // went.
              if (listRef.current?.contains(document.activeElement)) {
                return;
              }

              setHeldHrefs(null);
            }}
          >
            {photoLabel(photo)}
          </button>
        </li>
      ))}
    </ul>
  );
};

/* -------------------------------------------------------------------------- */
/* Rich pins — one DOM marker each                                             */
/* -------------------------------------------------------------------------- */

const MapPhotoMarker = ({
  photo,
  showMarkerImages,
  previewMarkers = false,
  emphasiseRoute,
  activeRouteHrefSet,
  onSelect,
  onHover,
  observeMarker,
}: {
  photo: LocatedPhoto;
  showMarkerImages: boolean;
  previewMarkers?: boolean;
  emphasiseRoute: boolean;
  activeRouteHrefSet: ReadonlySet<string>;
  onSelect: (photo: PhotoWithStyle) => void;
  onHover: (photo: PhotoWithStyle | null) => void;
  observeMarker: ObserveMapMarker;
}) => {
  const [isImageVisible, setIsImageVisible] = React.useState(false);
  const stopObservingRef = React.useRef<(() => void) | null>(null);
  const markerRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      stopObservingRef.current?.();
      stopObservingRef.current =
        element && (showMarkerImages || previewMarkers)
          ? observeMarker(element, setIsImageVisible)
          : null;
    },
    [observeMarker, showMarkerImages, previewMarkers],
  );

  React.useEffect(() => {
    if (!showMarkerImages && !previewMarkers) {
      setIsImageVisible(false);
    }
  }, [showMarkerImages, previewMarkers]);

  React.useEffect(
    () => () => {
      stopObservingRef.current?.();
    },
    [],
  );

  const formattedDate = formatMapPhotoDate(photo.date);
  const routeClass =
    emphasiseRoute && activeRouteHrefSet.size > 0
      ? activeRouteHrefSet.has(photo.href)
        ? styles.pinActive
        : styles.pinMuted
      : "";

  return (
    <Marker
      at={{ lng: photo.decLng, lat: photo.decLat }}
      anchor="center"
      onClick={(event) => {
        event.originalEvent.stopPropagation();
        onSelect(photo);
      }}
    >
      <div ref={markerRef} className={previewMarkers ? styles.markerPreview : undefined}>
        {(showMarkerImages || previewMarkers) && isImageVisible ? (
          <LazyMapMarkerImage photo={photo} />
        ) : null}
        {previewMarkers ? (
          // Decorative: the pin below already carries the same album and date as
          // its accessible name, so announcing it twice would only add noise.
          <span className={styles.markerPreviewLabel} aria-hidden="true">
            {photo.album}
            {formattedDate ? <span>{formattedDate}</span> : null}
          </span>
        ) : null}
        <span
          data-map-pin
          style={{ color: photo.markerColor }}
          className={[pinStyles.pin, routeClass].filter(Boolean).join(" ")}
          role="button"
          tabIndex={0}
          aria-label={photoLabel(photo)}
          onMouseOver={() => {
            onHover(photo);
          }}
          onMouseLeave={() => {
            onHover(null);
          }}
          onFocus={() => {
            onHover(photo);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onSelect(photo);
            }
          }}
        />
      </div>
    </Marker>
  );
};

/**
 * Photo pins take one of two forms, and the choice is what keeps the map fast.
 *
 * Plain pins are bulk data: one `<DataLayer>` hands the whole set to the map,
 * which draws it in a single GPU pass. A DOM marker each meant ~1400 nodes at
 * world zoom, every one of them reprojected on every frame of a pan (measured
 * at ~22.5µs per marker per frame — roughly half the frame budget, and all of
 * the main-thread blocking).
 *
 * A marker showing its thumbnail cannot be expressed that way: the image is
 * lazily loaded once the marker scrolls into view, which needs a real element
 * to observe. That set is deliberately small — it only appears zoomed in, or
 * when a search has narrowed the map to a handful of results — so a DOM marker
 * each costs little.
 *
 * What a drawn point does not get for free is a way in for a pointer that is
 * not precise, and a way in for a reader who is not using a pointer at all.
 * Both are added back here rather than left to the DOM path, which only appears
 * once the map is zoomed well in.
 */
export const MapPhotoMarkers = ({
  photos,
  visiblePhotos,
  showMarkerImages,
  previewMarkers = false,
  emphasiseRoute,
  activeRouteHrefSet,
  order,
  onSelect,
  onHover,
}: MapPhotoMarkersProps) => {
  const observeMarker = useSharedMapMarkerObserver();
  const isCoarsePointer = useCoarsePointer();
  const locatedPhotos = React.useMemo(() => photos.filter(hasCoordinates), [photos]);
  const locatedVisiblePhotos = React.useMemo(
    () => visiblePhotos.filter(hasCoordinates),
    [visiblePhotos],
  );
  // Held as `null` unless a route is actually being emphasised: the set behind
  // it changes on every hover, and rebuilding the whole feature collection for
  // an emphasis nobody is drawing would give the cost straight back.
  const emphasisedHrefs = emphasiseRoute && activeRouteHrefSet.size > 0 ? activeRouteHrefSet : null;
  const points = React.useMemo(
    (): PointFeature[] =>
      locatedPhotos.map((photo) => ({
        id: photo.href,
        at: { lng: photo.decLng, lat: photo.decLat },
        color: photo.markerColor,
        radius: PIN_RADIUS,
        opacity: pinOpacity(photo, emphasisedHrefs),
      })),
    [locatedPhotos, emphasisedHrefs],
  );
  // Invisible, and deliberately independent of the drawn pins: nothing about a
  // tap target changes when a route is emphasised, so it is not rebuilt then.
  // Bounds-filtered, unlike the pins, and so never the larger of the two layers
  // — the pins take the whole set and let the map clip it. The bounds only
  // settle at the end of a gesture, so this is rebuilt once a pan, not once a
  // frame.
  //
  // Zero opacity is not a way out of drawing it: MapLibre's `drawCircles` only
  // bails on a *constant* zero, and this layer's opacity is a per-feature
  // expression.
  const touchTargets = React.useMemo((): PointFeature[] => {
    if (!isCoarsePointer) {
      return [];
    }

    const radius = touchTargetRadius(locatedVisiblePhotos.length);
    // Shrunk all the way to the drawn pin's own radius, the target is no longer
    // widening anything: MapLibre hit-tests a circle at its radius plus its
    // stroke, so the pins — 7px and a 2px halo — answer a tap over at least as
    // much of the screen as this would. Handing the interactions back there
    // costs the reader nothing, which is what makes this boundary safe to have:
    // the two behave identically where it falls.
    if (radius <= PIN_RADIUS) {
      return [];
    }

    return locatedVisiblePhotos.map((photo) => ({
      id: photo.href,
      at: { lng: photo.decLng, lat: photo.decLat },
      radius,
      opacity: 0,
    }));
  }, [isCoarsePointer, locatedVisiblePhotos]);
  const photosByHref = React.useMemo(
    () => new Map(locatedPhotos.map((photo) => [photo.href, photo])),
    [locatedPhotos],
  );
  const selectPoint = React.useCallback(
    ({ id }: { id: string }) => {
      const photo = photosByHref.get(id);
      if (photo) {
        onSelect(photo);
      }
    },
    [onSelect, photosByHref],
  );
  const hoverPoint = React.useCallback(
    (point: { id: string } | null) => {
      onHover(point ? (photosByHref.get(point.id) ?? null) : null);
    },
    [onHover, photosByHref],
  );

  if (!showMarkerImages && !previewMarkers) {
    // Where a coarse-pointer target layer exists it is the one that listens: two
    // layers reporting the same tap would read as two taps, which is how a
    // stacked location cycles past the photo the reader meant to open.
    const interactions = { onPointClick: selectPoint, onPointHover: hoverPoint };

    return (
      <>
        {touchTargets.length > 0 ? (
          <DataLayer
            id="photo-marker-targets"
            points={touchTargets}
            {...(order !== undefined ? { order: order - 1 } : {})}
            {...interactions}
          />
        ) : null}
        <DataLayer
          id="photo-markers"
          points={points}
          stroke={PIN_HALO}
          {...(order !== undefined ? { order } : {})}
          {...(touchTargets.length > 0 ? {} : interactions)}
        />
        <MapPhotoKeyboardList
          photos={locatedVisiblePhotos}
          available={photosByHref}
          onSelect={onSelect}
          onHover={onHover}
        />
      </>
    );
  }

  return (
    <>
      {locatedVisiblePhotos.map((photo) => (
        <MapPhotoMarker
          key={photo.href}
          photo={photo}
          showMarkerImages={showMarkerImages}
          previewMarkers={previewMarkers}
          emphasiseRoute={emphasiseRoute}
          activeRouteHrefSet={activeRouteHrefSet}
          onSelect={onSelect}
          onHover={onHover}
          observeMarker={observeMarker}
        />
      ))}
    </>
  );
};
