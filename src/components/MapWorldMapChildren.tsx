import React from "react";
import { useMap } from "react-map-gl/maplibre";
import { computeWrapAwareBounds } from "../util/mapBounds";
import type { MapWorldEntry } from "./MapWorld";
import type { MapBounds } from "./mapWorldViewModel";
import { getMiddleDragCamera } from "./mapInteractions";
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

    // Two or more validated coordinates always produce bounds.
    const bounds = computeWrapAwareBounds(coordinates)!;

    map.fitBounds(bounds, {
      padding: 36,
      duration: 0,
      maxZoom: 11,
    });
  }, [enabled, map, photos]);

  return null;
};

export type ObserveMapMarker = (
  element: Element,
  onVisibilityChange: (isVisible: boolean) => void,
) => () => void;

export const useSharedMapMarkerObserver = (): ObserveMapMarker => {
  const observerRef = React.useRef<IntersectionObserver | null>(null);
  const listenersRef = React.useRef(new Map<Element, (isVisible: boolean) => void>());

  const observe = React.useCallback<ObserveMapMarker>((element, onVisibilityChange) => {
    if (typeof IntersectionObserver === "undefined") {
      return () => {};
    }

    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            listenersRef.current.get(entry.target)?.(entry.isIntersecting);
          });
        },
        { rootMargin: "100px" },
      );
    }

    listenersRef.current.set(element, onVisibilityChange);
    observerRef.current.observe(element);

    return () => {
      observerRef.current?.unobserve(element);
      listenersRef.current.delete(element);
    };
  }, []);

  React.useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      listenersRef.current.clear();
    },
    [],
  );

  return observe;
};

export const LazyMapMarkerImage = ({ photo }: { photo: MapWorldEntry }) => {
  return (
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

/** Adds desktop middle-button orbit without replacing MapLibre's native gestures. */
export const MapMiddleDragOrbit = ({ onInteractionStart }: { onInteractionStart: () => void }) => {
  const { current: map } = useMap();

  React.useEffect(() => {
    if (!map) {
      return;
    }

    const canvas = map.getCanvasContainer();
    let drag: {
      pointerId: number;
      startX: number;
      startY: number;
      startBearing: number;
      startPitch: number;
      restoreDragPan: boolean;
    } | null = null;

    const finish = (event?: PointerEvent) => {
      if (!drag || (event && event.pointerId !== drag.pointerId)) {
        return;
      }
      if (drag.restoreDragPan) {
        map.dragPan.enable();
      }
      drag = null;
      canvas.classList.remove(styles.orbiting);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 1) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onInteractionStart();
      const restoreDragPan = map.dragPan.isEnabled();
      if (restoreDragPan) {
        map.dragPan.disable();
      }
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startBearing: map.getBearing(),
        startPitch: map.getPitch(),
        restoreDragPan,
      };
      canvas.classList.add(styles.orbiting);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      event.preventDefault();
      map.jumpTo(
        getMiddleDragCamera({
          startBearing: drag.startBearing,
          startPitch: drag.startPitch,
          deltaX: event.clientX - drag.startX,
          deltaY: event.clientY - drag.startY,
        }),
      );
    };

    const preventMiddleAuxClick = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown, true);
    canvas.addEventListener("auxclick", preventMiddleAuxClick);
    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", finish, { capture: true });
    window.addEventListener("pointercancel", finish, { capture: true });

    return () => {
      finish();
      canvas.removeEventListener("pointerdown", onPointerDown, true);
      canvas.removeEventListener("auxclick", preventMiddleAuxClick);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
    };
  }, [map, onInteractionStart]);

  return null;
};
