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
  photos: PhotoWithStyle[];
  showMarkerImages: boolean;
  /**
   * Preview each marker in place with its thumbnail and album, rather than
   * making you click pins to find out what matched. Only for a small result
   * set — captioning hundreds of pins buries the map under its own labels.
   */
  previewMarkers?: boolean;
  emphasiseRoute: boolean;
  activeRouteHrefSet: ReadonlySet<string>;
  onSelect: (photo: PhotoWithStyle) => void;
  onHover: (photo: PhotoWithStyle | null) => void;
};

type LocatedPhoto = PhotoWithStyle & { decLat: number; decLng: number };

const hasCoordinates = (photo: PhotoWithStyle): photo is LocatedPhoto =>
  photo.decLat !== null && photo.decLng !== null;

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

const pinOpacity = (photo: LocatedPhoto, emphasisedHrefs: ReadonlySet<string> | null): number => {
  if (!emphasisedHrefs) {
    return PIN_OPACITY;
  }

  return emphasisedHrefs.has(photo.href) ? ROUTE_ACTIVE_OPACITY : ROUTE_MUTED_OPACITY;
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
}: Omit<MapPhotoMarkersProps, "photos"> & {
  photo: LocatedPhoto;
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
          aria-label={`Photo from ${photo.album}${formattedDate ? ` on ${formattedDate}` : ""}`}
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
 */
export const MapPhotoMarkers = ({ photos, ...props }: MapPhotoMarkersProps) => {
  const { showMarkerImages, previewMarkers = false, emphasiseRoute, activeRouteHrefSet } = props;
  const observeMarker = useSharedMapMarkerObserver();
  const locatedPhotos = React.useMemo(() => photos.filter(hasCoordinates), [photos]);
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
  const photosByHref = React.useMemo(
    () => new Map(locatedPhotos.map((photo) => [photo.href, photo])),
    [locatedPhotos],
  );

  if (!showMarkerImages && !previewMarkers) {
    return (
      <DataLayer
        id="photo-markers"
        points={points}
        stroke={PIN_HALO}
        onPointClick={({ id }) => {
          const photo = photosByHref.get(id);
          if (photo) {
            props.onSelect(photo);
          }
        }}
        onPointHover={(point) => {
          props.onHover(point ? (photosByHref.get(point.id) ?? null) : null);
        }}
      />
    );
  }

  return (
    <>
      {locatedPhotos.map((photo) => (
        <MapPhotoMarker key={photo.href} photo={photo} {...props} observeMarker={observeMarker} />
      ))}
    </>
  );
};
