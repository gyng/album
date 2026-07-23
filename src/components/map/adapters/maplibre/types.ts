import type { GlMap, PaddingOptions } from "./engine";

/**
 * The handle consumers hold onto. Every map method this repo calls — `project`,
 * `unproject`, `flyTo`, `fitBounds`, `getBounds`, `getCenter`, `getZoom`,
 * `getContainer`, `getCanvas`, `on`/`off` — is native to the GL map, so there
 * is nothing to wrap.
 */
export type MapRef = GlMap;

/** The camera state, in the shape the existing callbacks already read. */
export type ViewState = {
  /** Longitude at the map centre. */
  longitude: number;
  /** Latitude at the map centre. */
  latitude: number;
  zoom: number;
  /** Rotation in degrees, anticlockwise from north. */
  bearing: number;
  /** Angle in degrees at which the camera looks at the ground. */
  pitch: number;
  /** Pixels reserved on each side of the viewport, shifting the vanishing point. */
  padding: PaddingOptions;
};

/** The camera events that carry a derived `viewState`. */
export type ViewStateChangeEventType =
  | "movestart"
  | "move"
  | "moveend"
  | "zoomstart"
  | "zoom"
  | "zoomend"
  | "dragstart"
  | "drag"
  | "dragend";

export type ViewStateChangeEvent = {
  type: ViewStateChangeEventType;
  target: MapRef;
  /** The DOM event behind the camera change, when the change came from input. */
  originalEvent: MouseEvent | TouchEvent | WheelEvent | undefined;
  viewState: ViewState;
};

/** Reads the live camera off the map — the map is the single source of truth. */
export const toViewState = (map: MapRef): ViewState => {
  const centre = map.getCenter();

  return {
    longitude: centre.lng,
    latitude: centre.lat,
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    padding: map.getPadding(),
  };
};

export const toViewStateChangeEvent = (
  type: ViewStateChangeEventType,
  map: MapRef,
  originalEvent: MouseEvent | TouchEvent | WheelEvent | undefined,
): ViewStateChangeEvent => ({
  type,
  target: map,
  originalEvent,
  viewState: toViewState(map),
});
