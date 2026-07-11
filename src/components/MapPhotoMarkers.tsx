import { Marker } from "react-map-gl/maplibre";
import type { PhotoWithStyle } from "./mapWorldViewModel";
import { formatMapPhotoDate } from "./mapWorldViewModel";
import { LazyMapMarkerImage } from "./MapWorldMapChildren";
import styles from "./MapWorld.module.css";
import pinStyles from "./mapPin.module.css";

type MapPhotoMarkersProps = {
  photos: PhotoWithStyle[];
  zoom: number | null;
  emphasiseRoute: boolean;
  activeRouteHrefSet: ReadonlySet<string>;
  onSelect: (photo: PhotoWithStyle) => void;
  onHover: (photo: PhotoWithStyle | null) => void;
};

export const MapPhotoMarkers = ({
  photos,
  zoom,
  emphasiseRoute,
  activeRouteHrefSet,
  onSelect,
  onHover,
}: MapPhotoMarkersProps) => (
  <>
    {photos.map((photo) => {
      if (photo.decLat === null || photo.decLng === null) {
        return null;
      }

      const formattedDate = formatMapPhotoDate(photo.date);
      const routeClass =
        emphasiseRoute && activeRouteHrefSet.size > 0
          ? activeRouteHrefSet.has(photo.href)
            ? styles.pinActive
            : styles.pinMuted
          : "";

      return (
        <Marker
          key={photo.href}
          longitude={photo.decLng}
          latitude={photo.decLat}
          anchor="center"
          onClick={(event) => {
            event.originalEvent.stopPropagation();
            onSelect(photo);
          }}
          color={photo.markerColor}
        >
          <div>
            {zoom !== null && zoom > 8.5 ? <LazyMapMarkerImage photo={photo} /> : null}
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
    })}
  </>
);
