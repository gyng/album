/**
 * A drop-in replacement for the `react-map-gl/maplibre` surface this repo uses.
 * Names match the ones `react-map-gl` exported, so consumers change only their
 * import path.
 *
 * The GL library is reached exclusively through `./engine` (seam 1).
 */
export {
  MapView as default,
  type MapErrorEvent,
  type MapViewProps as MapProps,
  type MapViewStatus,
} from "./MapView";
export { Marker, type MarkerEvent, type MarkerProps } from "./Marker";
export { Popup, type PopupEvent, type PopupProps } from "./Popup";
export { Source, type SourceProps } from "./Source";
export { Layer, type LayerProps } from "./Layer";
export { PointRelief, type PointReliefProps } from "./PointRelief";
export { useSourceGeneration } from "./context";
export { useMap, type MapCollection } from "./useMapInstance";
export {
  AttributionControl,
  type AttributionControlProps,
  FullscreenControl,
  type FullscreenControlProps,
  GeolocateControl,
  type GeolocateControlProps,
  NavigationControl,
  type NavigationControlProps,
  ScaleControl,
  type ScaleControlProps,
} from "./controls";
export type { MapRef, ViewState, ViewStateChangeEvent } from "./types";
export type {
  MapLayerMouseEvent,
  MapLibreEvent as MapEvent,
  MapMouseEvent,
  MapWheelEvent,
} from "./engine";
