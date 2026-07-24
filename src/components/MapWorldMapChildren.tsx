import React from "react";
import { type Bounds, type MapCamera, useMap } from "./map";
import { computeWrapAwareBounds } from "../util/mapBounds";
import type { MapWorldEntry } from "../util/pageDataTypes";
import type { MapBounds } from "./mapWorldViewModel";
import { getMiddleDragCamera } from "./mapInteractions";
import styles from "./MapWorld.module.css";

// Frames the map on a set of photos: flyTo a single point, or fitBounds the
// enclosing rectangle. Shared by the initial auto-fit and the on-demand
// "Fit to results" control.
const fitMapToPhotos = (map: MapCamera, photos: MapWorldEntry[]) => {
  const coordinates = photos
    .filter((photo) => photo.decLat !== null && photo.decLng !== null)
    .map((photo) => [photo.decLng as number, photo.decLat as number] as [number, number]);

  if (coordinates.length === 0) {
    return;
  }

  if (coordinates.length === 1) {
    const first = coordinates[0];
    if (!first) {
      return;
    }
    const [longitude, latitude] = first;
    map.flyTo({ center: { lng: longitude, lat: latitude }, zoom: 10.5, speed: 2.2 });
    return;
  }

  // Two or more validated coordinates always produce bounds.
  const [[west, south], [east, north]] = computeWrapAwareBounds(coordinates)!;
  const bounds: Bounds = [
    { lng: west, lat: south },
    { lng: east, lat: north },
  ];

  map.fitBounds(bounds, {
    padding: 36,
    duration: 0,
    maxZoom: 11,
  });
};

export const MapAutoFit = ({ enabled, photos }: { enabled: boolean; photos: MapWorldEntry[] }) => {
  const map = useMap();

  React.useEffect(() => {
    if (!enabled || !map) {
      return;
    }
    fitMapToPhotos(map, photos);
  }, [enabled, map, photos]);

  return null;
};

// Frames the current photos on demand, whenever `requestId` changes. This lets
// the map filter in place while a search is typed (auto-fit stays off during a
// search) yet still offer a one-tap "fit to these results".
export const MapFitOnRequest = ({
  requestId,
  photos,
}: {
  requestId: number;
  photos: MapWorldEntry[];
}) => {
  const map = useMap();
  const handledRef = React.useRef(requestId);

  React.useEffect(() => {
    if (!map || requestId === handledRef.current) {
      return;
    }
    handledRef.current = requestId;
    fitMapToPhotos(map, photos);
  }, [map, requestId, photos]);

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

// Expands a viewport bounds by `padding` screen pixels on every edge, converting
// pixels to degrees from the current span so it is correct at any zoom. Used to
// mount thumbnail markers just outside the viewport, so their images are already
// in place by the time they scroll into view rather than popping in at the edge.
const padBoundsByPixels = (
  bounds: MapBounds,
  container: HTMLElement,
  padding: number,
): MapBounds => {
  if (padding <= 0) {
    return bounds;
  }

  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;
  const latitudeSpan = bounds.north - bounds.south;
  // Longitude span, allowing for the antimeridian wrap where east < west.
  const rawLongitudeSpan = bounds.east - bounds.west;
  const longitudeSpan = rawLongitudeSpan >= 0 ? rawLongitudeSpan : rawLongitudeSpan + 360;
  const padLatitude = (padding / height) * latitudeSpan;
  const padLongitude = (padding / width) * longitudeSpan;

  return {
    north: bounds.north + padLatitude,
    south: bounds.south - padLatitude,
    east: bounds.east + padLongitude,
    west: bounds.west - padLongitude,
  };
};

export const MapBoundsTracker = ({
  onBoundsChange,
  onRenderBoundsChange,
  renderPadding = 0,
}: {
  onBoundsChange: (bounds: MapBounds) => void;
  /** Reports the viewport expanded by `renderPadding` pixels, for markers that
   *  should mount just outside the visible area. */
  onRenderBoundsChange?: (bounds: MapBounds) => void;
  renderPadding?: number;
}) => {
  const map = useMap();

  React.useEffect(() => {
    if (!map) {
      return;
    }

    const updateBounds = () => {
      const [southWest, northEast] = map.getBounds();
      const viewport: MapBounds = {
        north: northEast.lat,
        south: southWest.lat,
        east: northEast.lng,
        west: southWest.lng,
      };
      onBoundsChange(viewport);
      onRenderBoundsChange?.(padBoundsByPixels(viewport, map.getContainer(), renderPadding));
    };

    updateBounds();
    const unsubscribes = [map.on("moveend", updateBounds), map.on("zoomend", updateBounds)];

    return () => {
      unsubscribes.forEach((unsubscribe) => {
        unsubscribe();
      });
    };
  }, [map, onBoundsChange, onRenderBoundsChange, renderPadding]);

  return null;
};

/** Adds desktop middle-button orbit without replacing the map's native gestures. */
export const MapMiddleDragOrbit = ({ onInteractionStart }: { onInteractionStart: () => void }) => {
  const map = useMap();

  React.useEffect(() => {
    if (!map) {
      return;
    }

    const canvas = map.getGestureSurface();
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
        map.setDragPanEnabled(true);
      }
      drag = null;
      if (styles.orbiting) {
        canvas.classList.remove(styles.orbiting);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 1) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onInteractionStart();
      const restoreDragPan = map.isDragPanEnabled();
      if (restoreDragPan) {
        map.setDragPanEnabled(false);
      }
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startBearing: map.getBearing(),
        startPitch: map.getPitch(),
        restoreDragPan,
      };
      if (styles.orbiting) {
        canvas.classList.add(styles.orbiting);
      }
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
