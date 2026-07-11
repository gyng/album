import React from "react";
import { useMap } from "react-map-gl/maplibre";
import { useIntersectionObserver } from "usehooks-ts";
import { computeWrapAwareBounds } from "../util/mapBounds";
import type { MapWorldEntry } from "./MapWorld";
import type { MapBounds } from "./mapWorldViewModel";
import styles from "./MapWorld.module.css";

export const MapAutoFit = ({ enabled, photos }: { enabled: boolean; photos: MapWorldEntry[] }) => {
  const { current: map } = useMap();

  React.useEffect(() => {
    if (!enabled || !map) {
      return;
    }

    const coordinates = photos
      .filter((photo) => photo.decLat !== null && photo.decLng !== null)
      .map((photo) => [photo.decLng as number, photo.decLat as number] as [number, number]);

    if (coordinates.length === 0) {
      return;
    }

    if (coordinates.length === 1) {
      const [longitude, latitude] = coordinates[0];
      map.flyTo({ center: [longitude, latitude], zoom: 10.5, speed: 2.2 });
      return;
    }

    const bounds = computeWrapAwareBounds(coordinates);
    if (!bounds) {
      return;
    }

    map.fitBounds(bounds, {
      padding: 36,
      duration: 0,
      maxZoom: 11,
    });
  }, [enabled, map, photos]);

  return null;
};

export const LazyMapMarkerImage = ({ photo }: { photo: MapWorldEntry }) => {
  const { entry, ref } = useIntersectionObserver({ rootMargin: "100px" });
  const isVisible = Boolean(entry?.isIntersecting);

  return (
    <div ref={ref}>
      {isVisible ? (
        <img
          src={photo.src.src}
          className={styles.photoMarkerImage}
          width={photo.placeholderWidth}
          height={photo.placeholderHeight}
          style={{ backgroundColor: photo.placeholderColor }}
          loading="lazy"
          alt=""
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
};

export const MapBoundsTracker = ({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: MapBounds) => void;
}) => {
  const { current: map } = useMap();

  React.useEffect(() => {
    if (!map) {
      return;
    }

    const updateBounds = () => {
      const bounds = map.getBounds();
      if (bounds) {
        onBoundsChange({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
      }
    };

    updateBounds();
    map.on("moveend", updateBounds);
    map.on("zoomend", updateBounds);

    return () => {
      map.off("moveend", updateBounds);
      map.off("zoomend", updateBounds);
    };
  }, [map, onBoundsChange]);

  return null;
};
