/**
 * Seam 1 — the single module in the application that imports the GL library.
 *
 * `maplibre-gl` and `mapbox-gl` share an API family, so swapping engines is a
 * one-file change. No other adapter file may import the GL library directly.
 */
export * as gl from "maplibre-gl";

export type {
  AddLayerObject,
  AttributionControlOptions,
  ControlPosition,
  FilterSpecification,
  FullscreenControlOptions,
  GeoJSONSourceSpecification,
  GeolocateControlOptions,
  IControl,
  LayerSpecification,
  LngLat,
  LngLatBoundsLike,
  Map as GlMap,
  MapLayerMouseEvent,
  MapLibreEvent,
  MapMouseEvent,
  MapOptions,
  MapWheelEvent,
  Marker as GlMarker,
  MarkerOptions,
  NavigationControlOptions,
  Offset,
  PaddingOptions,
  Popup as GlPopup,
  PopupOptions,
  PositionAnchor,
  ProjectionSpecification,
  ScaleControlOptions,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
