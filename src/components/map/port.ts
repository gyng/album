/**
 * Seam 2 — the provider-neutral map port.
 *
 * Nothing in this file may reference an implementation: no `maplibre-gl`, no GL
 * style-spec, no React. It is the vocabulary application components speak, and
 * the contract any adapter has to satisfy. The MapLibre binding lives in
 * `./react.tsx` over `./adapters/maplibre/`.
 */

/** A geographic position, in degrees. */
export type LngLat = { lng: number; lat: number };

/** A geographic box as `[south-west, north-east]`. */
export type Bounds = [LngLat, LngLat];

/** A position in map-container pixels, origin at the container's top-left. */
export type ScreenPoint = { x: number; y: number };

/** A camera snapshot: where the map is looking, and how closely. */
export type CameraView = { center: LngLat; zoom: number };

export type FlyToOptions = {
  center: LngLat;
  zoom?: number;
  /** Animation speed multiplier; 1 is the provider's default pace. */
  speed?: number;
};

export type FitBoundsOptions = {
  /** Pixels of breathing room kept on every side. */
  padding?: number;
  maxZoom?: number;
  /** `false` jumps straight to the destination. */
  animate?: boolean;
};

/** Reading and moving the camera. */
export interface MapCamera {
  getCenter(): LngLat;
  getZoom(): number;
  getBounds(): Bounds;
  flyTo(options: FlyToOptions): void;
  fitBounds(bounds: Bounds, options?: FitBoundsOptions): void;
}

/** Converting between geographic and screen coordinates. */
export interface MapProjection {
  project(at: LngLat): ScreenPoint;
  unproject(at: ScreenPoint): LngLat;
}

/** Events that only report where the camera ended up. */
export type MapCameraEventName = "load" | "move" | "moveend" | "zoom" | "zoomend" | "dragstart";

/** Events raised by a pointer over the map surface. */
export type MapPointerEventName = "click" | "contextmenu";

export type MapCameraEvent = {
  type: MapCameraEventName;
  view: CameraView;
};

export type MapPointerEvent = {
  type: MapPointerEventName;
  /** Where the pointer was, on the ground. */
  at: LngLat;
  /** Where the pointer was, in container pixels. */
  point: ScreenPoint;
  originalEvent: MouseEvent;
};

export type MapWheelEvent = {
  type: "wheel";
  originalEvent: WheelEvent;
};

/** The payload each subscribable event carries. */
export type MapEventMap = {
  load: MapCameraEvent;
  move: MapCameraEvent;
  moveend: MapCameraEvent;
  zoom: MapCameraEvent;
  zoomend: MapCameraEvent;
  dragstart: MapCameraEvent;
  click: MapPointerEvent;
  contextmenu: MapPointerEvent;
  wheel: MapWheelEvent;
};

export type MapEventName = keyof MapEventMap;

export type MapEvent = MapEventMap[MapEventName];

/** The live map handle. Held only while the map is mounted and loaded. */
export interface MapInstance extends MapCamera, MapProjection {
  /**
   * Subscribes to a map event. Returns an unsubscribe function — callers never
   * have to hold on to the listener to detach it.
   *
   * Narrowed by event name, so `on("moveend", …)` sees a camera event and
   * `on("click", …)` sees a pointer one; `on(name: MapEventName, …)` still
   * type-checks with a listener taking the full `MapEvent` union.
   */
  on<Name extends MapEventName>(
    event: Name,
    listener: (event: MapEventMap[Name]) => void,
  ): () => void;
  getContainer(): HTMLElement;
}

/** Where a marker's element sits relative to its position. */
export type MarkerAnchor =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/**
 * Neutral data descriptions — deliberately not GL style-spec. Bulk data is
 * described as features with their own colour and size, and the adapter decides
 * how to draw them (for MapLibre, one GPU layer rather than one node each).
 */
export type PointFeature = {
  id: string;
  at: LngLat;
  /** Any CSS colour the provider understands. Falls back to the port default. */
  color?: string;
  /** Radius in pixels. Falls back to the port default. */
  radius?: number;
};

export type LineFeature = {
  id: string;
  path: LngLat[];
  color: string;
  /** Stroke width in pixels. */
  width: number;
};
