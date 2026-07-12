import { Marker } from "react-map-gl/maplibre";
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
        element && showMarkerImages ? observeMarker(element, setIsImageVisible) : null;
    },
    [observeMarker, showMarkerImages],
  );

  React.useEffect(() => {
    if (!showMarkerImages) {
      setIsImageVisible(false);
    }
  }, [showMarkerImages]);

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
      <div ref={markerRef}>
        {showMarkerImages && isImageVisible ? <LazyMapMarkerImage photo={photo} /> : null}
        <span
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
