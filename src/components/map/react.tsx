/**
 * The neutral React map API — the only map module application components import.
 *
 * This file is the binding: it may talk to `./adapters/maplibre`, and it is the
 * one place where neutral shapes are translated into (and out of) the adapter's
 * vocabulary. It deliberately re-exports no provider types; everything crossing
 * this boundary is declared in `./port`.
 */
import React from "react";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import AdapterMap, {
  Layer,
  type LayerProps,
  type MapRef,
  Marker as AdapterMarker,
  Popup as AdapterPopup,
  Source,
  useMap as useAdapterMap,
} from "./adapters/maplibre";
import type {
  Bounds,
  CameraView,
  FitBoundsOptions,
  FlyToOptions,
  LineFeature,
  LngLat,
  MapEvent,
  MapEventName,
  MapInstance,
  MapPointerEvent,
  MarkerAnchor,
  PointFeature,
  ScreenPoint,
} from "./port";

/* -------------------------------------------------------------------------- */
/* Engine translation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The parts of the engine's own event objects this binding reads. Declared
 * structurally so the translation does not have to name provider types: a real
 * engine event satisfies these, and so does a test double.
 */
type EnginePointerEvent = {
  lngLat: { lng: number; lat: number };
  point: { x: number; y: number };
  originalEvent: MouseEvent;
};

type EngineWheelEvent = { originalEvent: WheelEvent };

const toLngLat = (position: { lng: number; lat: number }): LngLat => ({
  lng: position.lng,
  lat: position.lat,
});

const subscribe = (
  map: MapRef,
  event: MapEventName,
  emit: (event: MapEvent) => void,
): (() => void) => {
  if (event === "click" || event === "contextmenu") {
    const handler = (engineEvent: EnginePointerEvent) => {
      emit({
        type: event,
        at: toLngLat(engineEvent.lngLat),
        point: { x: engineEvent.point.x, y: engineEvent.point.y },
        originalEvent: engineEvent.originalEvent,
      });
    };
    map.on(event, handler);

    return () => {
      map.off(event, handler);
    };
  }

  if (event === "wheel") {
    const handler = (engineEvent: EngineWheelEvent) => {
      emit({ type: "wheel", originalEvent: engineEvent.originalEvent });
    };
    map.on("wheel", handler);

    return () => {
      map.off("wheel", handler);
    };
  }

  // Camera events carry no payload of their own: the map is the source of truth.
  const handler = () => {
    emit({ type: event, view: { center: toLngLat(map.getCenter()), zoom: map.getZoom() } });
  };
  map.on(event, handler);

  return () => {
    map.off(event, handler);
  };
};

const createMapInstance = (map: MapRef): MapInstance => ({
  getCenter: (): LngLat => toLngLat(map.getCenter()),
  getZoom: (): number => map.getZoom(),
  getBounds: (): Bounds => {
    const bounds = map.getBounds();

    return [
      { lng: bounds.getWest(), lat: bounds.getSouth() },
      { lng: bounds.getEast(), lat: bounds.getNorth() },
    ];
  },
  flyTo: (options: FlyToOptions): void => {
    map.flyTo({
      center: [options.center.lng, options.center.lat],
      ...(options.zoom !== undefined ? { zoom: options.zoom } : {}),
      ...(options.speed !== undefined ? { speed: options.speed } : {}),
    });
  },
  fitBounds: (bounds: Bounds, options?: FitBoundsOptions): void => {
    const [southWest, northEast] = bounds;
    map.fitBounds(
      [
        [southWest.lng, southWest.lat],
        [northEast.lng, northEast.lat],
      ],
      {
        ...(options?.padding !== undefined ? { padding: options.padding } : {}),
        ...(options?.maxZoom !== undefined ? { maxZoom: options.maxZoom } : {}),
        ...(options?.animate !== undefined ? { animate: options.animate } : {}),
      },
    );
  },
  project: (at: LngLat): ScreenPoint => {
    const point = map.project([at.lng, at.lat]);

    return { x: point.x, y: point.y };
  },
  unproject: (at: ScreenPoint): LngLat => toLngLat(map.unproject([at.x, at.y])),
  on: (event, listener) => subscribe(map, event, listener as (value: MapEvent) => void),
  getContainer: (): HTMLElement => map.getContainer(),
});

/**
 * One neutral handle per underlying map, so `useMap()` is referentially stable
 * across renders and the handle a consumer stores in an effect dependency list
 * does not churn.
 */
const instances = new WeakMap<MapRef, MapInstance>();

const toMapInstance = (map: MapRef): MapInstance => {
  const existing = instances.get(map);
  if (existing) {
    return existing;
  }

  const instance = createMapInstance(map);
  instances.set(map, instance);

  return instance;
};

/* -------------------------------------------------------------------------- */
/* Components                                                                  */
/* -------------------------------------------------------------------------- */

export type MapViewProps = {
  /** A style document URL the provider can load. */
  styleUrl: string;
  /** Read once, at construction — the camera is uncontrolled after that. */
  initialView?: { center?: LngLat; zoom?: number };
  onLoad?: (map: MapInstance) => void;
  onMoveEnd?: (view: CameraView) => void;
  onClick?: (event: MapPointerEvent) => void;
  onContextMenu?: (event: MapPointerEvent) => void;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export const MapView = ({
  styleUrl,
  initialView,
  onLoad,
  onMoveEnd,
  onClick,
  onContextMenu,
  children,
  className,
  style,
}: MapViewProps): React.JSX.Element => {
  const center = initialView?.center;
  const zoom = initialView?.zoom;

  return (
    <AdapterMap
      mapStyle={styleUrl}
      initialViewState={{
        ...(center ? { longitude: center.lng, latitude: center.lat } : {}),
        ...(zoom !== undefined ? { zoom } : {}),
      }}
      {...(className !== undefined ? { className } : {})}
      {...(style !== undefined ? { style } : {})}
      onLoad={(event) => {
        onLoad?.(toMapInstance(event.target));
      }}
      onMoveEnd={(event) => {
        onMoveEnd?.({
          center: { lng: event.viewState.longitude, lat: event.viewState.latitude },
          zoom: event.viewState.zoom,
        });
      }}
      onClick={(event) => {
        onClick?.({
          type: "click",
          at: toLngLat(event.lngLat),
          point: { x: event.point.x, y: event.point.y },
          originalEvent: event.originalEvent,
        });
      }}
      onContextMenu={(event) => {
        onContextMenu?.({
          type: "contextmenu",
          at: toLngLat(event.lngLat),
          point: { x: event.point.x, y: event.point.y },
          originalEvent: event.originalEvent,
        });
      }}
    >
      {children}
    </AdapterMap>
  );
};

/**
 * The live map, or `undefined` before it has loaded and outside a `<MapView>`.
 * Unlike the adapter's hook this returns the instance itself, not a holder.
 */
export const useMap = (): MapInstance | undefined => {
  const { current } = useAdapterMap();

  return React.useMemo(() => (current ? toMapInstance(current) : undefined), [current]);
};

export type MarkerProps = {
  at: LngLat;
  anchor?: MarkerAnchor;
  children: React.ReactNode;
};

/**
 * A single DOM marker — for the small, rich case (a photo thumbnail, a pin with
 * its own interactions). Bulk data belongs in `<DataLayer>`.
 */
export const Marker = ({ at, anchor, children }: MarkerProps): React.JSX.Element => (
  <AdapterMarker longitude={at.lng} latitude={at.lat} {...(anchor !== undefined ? { anchor } : {})}>
    {children}
  </AdapterMarker>
);

export type PopupProps = {
  at: LngLat;
  children: React.ReactNode;
};

export const Popup = ({ at, children }: PopupProps): React.JSX.Element => (
  <AdapterPopup longitude={at.lng} latitude={at.lat}>
    {children}
  </AdapterPopup>
);

/* -------------------------------------------------------------------------- */
/* DataLayer                                                                   */
/* -------------------------------------------------------------------------- */

/** Used when a point does not carry its own colour. */
const DEFAULT_POINT_COLOUR = "rgb(230, 32, 101)";
/** Used when a point does not carry its own radius, in pixels. */
const DEFAULT_POINT_RADIUS = 5;
const CLUSTER_MAX_ZOOM = 12;
const CLUSTER_RADIUS = 42;

type PointProperties = { id: string; color?: string; radius?: number };
type LineProperties = { id: string; color: string; width: number };

const toPointCollection = (
  points: readonly PointFeature[],
): FeatureCollection<Point, PointProperties> => ({
  type: "FeatureCollection",
  features: points.map(
    (point): Feature<Point, PointProperties> => ({
      type: "Feature",
      id: point.id,
      properties: {
        id: point.id,
        ...(point.color !== undefined ? { color: point.color } : {}),
        ...(point.radius !== undefined ? { radius: point.radius } : {}),
      },
      geometry: { type: "Point", coordinates: [point.at.lng, point.at.lat] },
    }),
  ),
});

const toLineCollection = (
  lines: readonly LineFeature[],
): FeatureCollection<LineString, LineProperties> => ({
  type: "FeatureCollection",
  features: lines.map(
    (line): Feature<LineString, LineProperties> => ({
      type: "Feature",
      id: line.id,
      properties: { id: line.id, color: line.color, width: line.width },
      geometry: {
        type: "LineString",
        coordinates: line.path.map((at) => [at.lng, at.lat]),
      },
    }),
  ),
});

/**
 * Colour and radius are read off each feature so one layer can draw a whole set
 * of differently styled points — that is what keeps bulk data on the GPU.
 */
const circleLayer = (id: string, clustered: boolean): LayerProps =>
  clustered
    ? {
        id: `${id}-point-circles`,
        type: "circle",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["coalesce", ["get", "color"], DEFAULT_POINT_COLOUR],
          "circle-radius": ["coalesce", ["get", "radius"], DEFAULT_POINT_RADIUS],
        },
      }
    : {
        id: `${id}-point-circles`,
        type: "circle",
        paint: {
          "circle-color": ["coalesce", ["get", "color"], DEFAULT_POINT_COLOUR],
          "circle-radius": ["coalesce", ["get", "radius"], DEFAULT_POINT_RADIUS],
        },
      };

const clusterLayer = (id: string): LayerProps => ({
  id: `${id}-clusters`,
  type: "circle",
  filter: ["has", "point_count"],
  paint: {
    "circle-color": DEFAULT_POINT_COLOUR,
    "circle-stroke-color": "rgba(255, 255, 255, 0.78)",
    "circle-stroke-width": 2,
    "circle-radius": ["step", ["get", "point_count"], 13, 10, 18, 30, 24, 80, 31],
    "circle-blur": 0.08,
  },
});

const clusterLabelLayer = (id: string): LayerProps => ({
  id: `${id}-cluster-labels`,
  type: "symbol",
  filter: ["has", "point_count"],
  layout: {
    "text-field": ["get", "point_count"],
    "text-size": 12,
    "text-font": ["Noto Sans Bold"],
  },
  paint: {
    "text-color": "rgba(0, 0, 0, 0.9)",
    "text-halo-color": "rgba(255, 255, 255, 0.96)",
    "text-halo-width": 1.2,
    "text-halo-blur": 0.4,
  },
});

const lineLayer = (id: string): LayerProps => ({
  id: `${id}-line-strokes`,
  type: "line",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": ["get", "color"],
    "line-width": ["get", "width"],
  },
});

export type DataLayerProps = {
  /** Prefixes the source and layer ids this layer owns. */
  id: string;
  points?: readonly PointFeature[];
  lines?: readonly LineFeature[];
  /** Groups nearby points into counted clusters at low zoom. */
  cluster?: boolean;
};

/**
 * Bulk data drawn by the provider rather than by React — one GPU pass for the
 * whole set, instead of a DOM node per feature. Callers describe features; the
 * style-spec that renders them never leaves this module.
 */
export const DataLayer = ({
  id,
  points,
  lines,
  cluster = false,
}: DataLayerProps): React.JSX.Element => {
  const pointData = React.useMemo(() => (points ? toPointCollection(points) : null), [points]);
  const lineData = React.useMemo(() => (lines ? toLineCollection(lines) : null), [lines]);

  return (
    <>
      {pointData ? (
        <Source
          id={`${id}-points`}
          type="geojson"
          data={pointData}
          cluster={cluster}
          {...(cluster ? { clusterMaxZoom: CLUSTER_MAX_ZOOM, clusterRadius: CLUSTER_RADIUS } : {})}
        >
          {cluster ? <Layer {...clusterLayer(id)} /> : null}
          {cluster ? <Layer {...clusterLabelLayer(id)} /> : null}
          <Layer {...circleLayer(id, cluster)} />
        </Source>
      ) : null}
      {lineData ? (
        <Source id={`${id}-lines`} type="geojson" data={lineData}>
          <Layer {...lineLayer(id)} />
        </Source>
      ) : null}
    </>
  );
};
