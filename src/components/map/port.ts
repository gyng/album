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
  /** Rotation in degrees, anticlockwise from north. */
  bearing?: number;
  /** Angle in degrees at which the camera looks at the ground; 0 is straight down. */
  pitch?: number;
  /** Flight length in milliseconds; `0` arrives immediately. */
  duration?: number;
};

export type FitBoundsOptions = {
  /**
   * Pixels of breathing room. A number keeps the same on every side; name the
   * sides where they differ — a marker whose picture stands above its pin needs
   * room at the top that the bottom would only waste.
   */
  padding?: number | { top: number; right: number; bottom: number; left: number };
  maxZoom?: number;
  /**
   * The tilt to arrive at. Worth naming because the provider's own default is
   * flat: a fit issued after load levels a pitched camera, so a basemap that
   * draws its buildings with height loses them the moment the map frames
   * anything.
   */
  pitch?: number;
  /** `false` jumps straight to the destination. */
  animate?: boolean;
  /** Animation length in milliseconds; `0` arrives immediately. */
  duration?: number;
};

/** An immediate camera move — no animation, whatever the provider's default is. */
export type JumpToOptions = {
  center?: LngLat;
  zoom?: number;
  /** Rotation in degrees, anticlockwise from north. */
  bearing?: number;
  /** Angle in degrees at which the camera looks at the ground; 0 is straight down. */
  pitch?: number;
};

/** Reading and moving the camera. */
export interface MapCamera {
  getCenter(): LngLat;
  getZoom(): number;
  getBounds(): Bounds;
  /** Rotation in degrees, anticlockwise from north. */
  getBearing(): number;
  /** Angle in degrees at which the camera looks at the ground; 0 is straight down. */
  getPitch(): number;
  flyTo(options: FlyToOptions): void;
  fitBounds(bounds: Bounds, options?: FitBoundsOptions): void;
  jumpTo(options: JumpToOptions): void;
  /** Halts any camera animation in flight, leaving the camera where it is. */
  stop(): void;
}

/** Converting between geographic and screen coordinates. */
export interface MapProjection {
  project(at: LngLat): ScreenPoint;
  unproject(at: ScreenPoint): LngLat;
}

/**
 * Events that only report where the camera ended up.
 *
 * There is deliberately no `load`: a `MapInstance` only exists once the map has
 * loaded, and every child mounts after that, so a listener attached here could
 * never fire. `MapView`'s `onLoad` is how loading is heard about.
 */
export type MapCameraEventName =
  | "movestart"
  | "move"
  | "moveend"
  | "zoomstart"
  | "zoom"
  | "zoomend"
  | "dragstart"
  | "resize";

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
  movestart: MapCameraEvent;
  move: MapCameraEvent;
  moveend: MapCameraEvent;
  zoomstart: MapCameraEvent;
  zoom: MapCameraEvent;
  zoomend: MapCameraEvent;
  dragstart: MapCameraEvent;
  resize: MapCameraEvent;
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
  /**
   * The element the provider handles map gestures on, inside the container.
   * Listen here — rather than on the container — to add a gesture without
   * catching pointer work aimed at overlaid controls.
   */
  getGestureSurface(): HTMLElement;
  /** Whether dragging the map surface pans the camera. */
  isDragPanEnabled(): boolean;
  /** Suspends or restores drag-to-pan, so another gesture can own the drag. */
  setDragPanEnabled(enabled: boolean): void;
}

/** How the globe is flattened onto the screen. */
export type MapProjectionMode = "mercator" | "globe" | "vertical-perspective";

/** The attribution notice: hidden outright, or shown with these options. */
export type MapAttribution =
  | false
  | {
      /** Shrink the credit line to a badge the reader expands. */
      compact?: boolean;
      /**
       * Start that badge shut. Providers tend to render a compact notice open
       * and only fold it away once you touch the map, which crowds the bottom
       * of a small screen until then. Only meaningful with `compact`.
       */
      collapsed?: boolean;
    };

/** Where a map control is anchored inside the map's own frame. */
export type MapControlPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

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
  /**
   * Opacity from 0 to 1, applied to the point and its halo. Falls back to
   * fully opaque. Per-feature so one layer can still de-emphasise part of a
   * set — fading everything off a route, say — without splitting it in two.
   */
  opacity?: number;
  /**
   * Draw order among overlapping points in the same layer: higher draws on
   * top. Defaults to 0, which leaves every point tied and the winner arbitrary.
   *
   * Needed because feature array order carries no such promise — a provider is
   * free to draw a collection in whatever order suits it, so overlap has to be
   * resolved by a value rather than by position.
   */
  sortKey?: number;
};

/** The colour a point is drawn in when it carries none of its own. */
export const DEFAULT_POINT_COLOUR = "rgb(230, 32, 101)";

/** The radius, in pixels, a point is drawn at when it carries none of its own. */
export const DEFAULT_POINT_RADIUS = 5;

/**
 * The font a cluster's count is lettered in when the caller names none.
 *
 * A font stack is not decoration: a provider can only letter with faces its
 * style ships glyphs for, and asking for one it does not have draws nothing at
 * all rather than falling back. This is the face the MapTiler styles this site
 * uses provide — any other style has to name its own through
 * `DataLayer`'s `clusterLabelFont`.
 */
export const DEFAULT_CLUSTER_LABEL_FONT: readonly string[] = ["Noto Sans Bold"];

/** The point a pointer interaction landed on. */
export type PointFeatureHit = {
  /** The `id` of the `PointFeature` under the pointer. */
  id: string;
  /** Where the pointer was, on the ground. */
  at: LngLat;
};

/** A halo drawn around every point in a layer. */
export type PointStroke = { color: string; width: number };

/**
 * A stroke width in pixels at a fraction along a line — `0` at its start, `1`
 * at its end. A run of stops describes a taper, interpolated between them.
 */
export type LineWidthStop = { at: number; width: number };

export type LineFeature = {
  id: string;
  path: LngLat[];
  color: string;
  /**
   * Stroke width in pixels. Where the layer tapers its lines (see
   * `lineWidthAlong`) this is the flat width a provider that cannot taper
   * falls back to.
   */
  width: number;
  /** Opacity from 0 to 1. Falls back to fully opaque. */
  opacity?: number;
  /** Softens the stroke by this many pixels — a glow rather than a crisp edge. */
  blur?: number;
  /**
   * Alternating dash and gap lengths, in stroke widths; omitted draws a solid
   * line. Providers cannot vary a dash pattern within one drawn layer, so lines
   * are grouped by pattern behind the port.
   */
  dash?: number[];
};
