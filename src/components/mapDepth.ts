import React from "react";
import type { LngLat, MapInstance } from "./map";

/**
 * Drawing order for DOM markers on a tilted map.
 *
 * Flat, a map has no depth and pins are ordered by whatever the map is about —
 * recency on the world map, the journey on a trip. Tilted, the ground recedes
 * up the screen, so a pin drawn over another is claiming to be in front of it:
 * the far one has to go behind. Screen-space y says exactly that, and it holds
 * whatever the bearing is, because rotating the camera rotates the projection
 * with it.
 */

/** Below this the map reads as a plan and the depth ordering is noise. */
export const PITCH_ORDERING_THRESHOLD = 10;

export const isPitched = (pitch: number): boolean => pitch >= PITCH_ORDERING_THRESHOLD;

/**
 * A z-index from a projected point: further down the screen is nearer the
 * camera, so it draws on top. Rounded because a z-index is an integer, and
 * floored at zero because a marker above the horizon would otherwise sort
 * behind the basemap.
 */
export const depthSortKey = (screenY: number): number => Math.max(0, Math.round(screenY));

/**
 * Depth ordering for markers, recomputed when the camera settles.
 *
 * Not on every frame: MapLibre already reschedules every marker each frame, and
 * a projection per marker per frame on top of that is the cost the world map's
 * DOM markers were measured down to. Between settlings the order is a frame or
 * two stale, which nobody can see while the map is still moving.
 */
export const useMarkerDepth = (
  map: MapInstance | null | undefined,
): { pitched: boolean; keyFor: (at: LngLat) => number | null } => {
  const [camera, setCamera] = React.useState(() => ({ pitch: 0, version: 0 }));

  React.useEffect(() => {
    if (!map) return;

    const settle = () => {
      setCamera((previous) => {
        const pitch = map.getPitch();
        // A version bump forces the projection to be read again even when the
        // pitch itself has not changed — a pan or a rotation moves every pin.
        return { pitch, version: previous.version + 1 };
      });
    };

    settle();
    const offMove = map.on("moveend", settle);
    const offZoom = map.on("zoomend", settle);
    return () => {
      offMove();
      offZoom();
    };
  }, [map]);

  const pitched = isPitched(camera.pitch);

  const keyFor = React.useCallback(
    (at: LngLat): number | null => {
      if (!map || !pitched) return null;
      return depthSortKey(map.project(at).y);
    },
    // `camera.version` is the dependency that matters: the projection changes
    // with the camera, not with the map object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, pitched, camera.version],
  );

  return { pitched, keyFor };
};
