import { Marker } from "./map/adapters/maplibre";
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
      longitude={photo.decLng}
      latitude={photo.decLat}
      anchor="center"
      onClick={(event) => {
        event.originalEvent.stopPropagation();
        onSelect(photo);
      }}
      color={photo.markerColor}
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

export const MapPhotoMarkers = ({ photos, ...props }: MapPhotoMarkersProps) => {
  const observeMarker = useSharedMapMarkerObserver();

  return (
    <>
      {photos.map((photo) => {
        if (!hasCoordinates(photo)) {
          return null;
        }

        return (
          <MapPhotoMarker key={photo.href} photo={photo} {...props} observeMarker={observeMarker} />
        );
      })}
    </>
  );
};
