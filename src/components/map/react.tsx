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
  FullscreenControl as AdapterFullscreenControl,
  GeolocateControl as AdapterGeolocateControl,
  Layer,
  type LayerProps,
  type MapRef,
  Marker as AdapterMarker,
  NavigationControl as AdapterNavigationControl,
  Popup as AdapterPopup,
  ScaleControl as AdapterScaleControl,
  Source,
  useMap as useAdapterMap,
} from "./adapters/maplibre";
import type {
  Bounds,
  CameraView,
  FitBoundsOptions,
  FlyToOptions,
  JumpToOptions,
  LineFeature,
  LineWidthStop,
  LngLat,
  MapAttribution,
  MapControlPosition,
  MapEvent,
  MapEventName,
  MapInstance,
  MapPointerEvent,
  MapProjectionMode,
  MapWheelEvent,
  MarkerAnchor,
  PointFeature,
  PointFeatureHit,
  PointStroke,
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

/** The camera events the engine reports, in the shape the adapter hands them over. */
type EngineCameraEvent = {
  viewState: { longitude: number; latitude: number; zoom: number };
};

const toLngLat = (position: { lng: number; lat: number }): LngLat => ({
  lng: position.lng,
  lat: position.lat,
});

const toCameraView = (event: EngineCameraEvent): CameraView => ({
  center: { lng: event.viewState.longitude, lat: event.viewState.latitude },
  zoom: event.viewState.zoom,
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
  getBearing: (): number => map.getBearing(),
  getPitch: (): number => map.getPitch(),
  flyTo: (options: FlyToOptions): void => {
    map.flyTo({
      center: [options.center.lng, options.center.lat],
      ...(options.zoom !== undefined ? { zoom: options.zoom } : {}),
      ...(options.speed !== undefined ? { speed: options.speed } : {}),
      ...(options.bearing !== undefined ? { bearing: options.bearing } : {}),
      ...(options.pitch !== undefined ? { pitch: options.pitch } : {}),
      ...(options.duration !== undefined ? { duration: options.duration } : {}),
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
        ...(options?.duration !== undefined ? { duration: options.duration } : {}),
      },
    );
  },
  jumpTo: (options: JumpToOptions): void => {
    map.jumpTo({
      ...(options.center !== undefined
        ? { center: [options.center.lng, options.center.lat] as [number, number] }
        : {}),
      ...(options.zoom !== undefined ? { zoom: options.zoom } : {}),
      ...(options.bearing !== undefined ? { bearing: options.bearing } : {}),
      ...(options.pitch !== undefined ? { pitch: options.pitch } : {}),
    });
  },
  stop: (): void => {
    map.stop();
  },
  project: (at: LngLat): ScreenPoint => {
    const point = map.project([at.lng, at.lat]);

    return { x: point.x, y: point.y };
  },
  unproject: (at: ScreenPoint): LngLat => toLngLat(map.unproject([at.x, at.y])),
  on: (event, listener) => subscribe(map, event, listener as (value: MapEvent) => void),
  getContainer: (): HTMLElement => map.getContainer(),
  getGestureSurface: (): HTMLElement => map.getCanvasContainer(),
  isDragPanEnabled: (): boolean => map.dragPan.isEnabled(),
  setDragPanEnabled: (enabled: boolean): void => {
    if (enabled) {
      map.dragPan.enable();
      return;
    }
    map.dragPan.disable();
  },
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

/** Neutral projection names translated into whatever the provider expects. */
const toAdapterProjection = (
  projection: MapProjectionMode,
): "mercator" | "globe" | { type: "vertical-perspective" } =>
  projection === "vertical-perspective" ? { type: projection } : projection;

/** `collapsed` is the port's own idea, so it never reaches the provider. */
const toAdapterAttribution = (attribution: MapAttribution): false | { compact?: boolean } =>
  attribution === false
    ? false
    : attribution.compact !== undefined
      ? { compact: attribution.compact }
      : {};

/**
 * `compact` only makes the attribution collapsible: MapLibre still renders it
 * open and only minimises it once you touch the map (`_updateCompact` adds
 * `maplibregl-compact-show`, `_updateCompactMinimize` removes it on
 * interaction). Shut it up front instead. This does not fight the control:
 * `_updateCompact` only re-adds the class when `maplibregl-compact` is absent,
 * and by now it is set, so resizing will not reopen it. The notice is a
 * `<details>`, so `open` has to go too, not just the class.
 *
 * The class names are the provider's, which is why collapsing lives here rather
 * than in a caller: the port only promises the notice starts shut.
 */
const collapseAttribution = (container: HTMLElement): void => {
  const notice = container.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
  notice?.classList.remove("maplibregl-compact-show");
  notice?.removeAttribute("open");
};

export type MapViewProps = {
  /** A style document URL the provider can load. */
  styleUrl: string;
  /** Read once, at construction — the camera is uncontrolled after that. */
  initialView?: { center?: LngLat; zoom?: number };
  /** Defaults to the provider's own choice, in practice Web Mercator. */
  projection?: MapProjectionMode;
  attribution?: MapAttribution;
  /** CSS cursor shown over the map surface. */
  cursor?: string;
  onLoad?: (map: MapInstance) => void;
  /** The camera has started moving, however the move was begun. */
  onMoveStart?: (view: CameraView) => void;
  onMoveEnd?: (view: CameraView) => void;
  onZoomStart?: (view: CameraView) => void;
  /** Fires throughout a zoom, so keep the work in it small. */
  onZoom?: (view: CameraView) => void;
  onZoomEnd?: (view: CameraView) => void;
  /** A drag of the map surface has begun. */
  onDragStart?: (view: CameraView) => void;
  onWheel?: (event: MapWheelEvent) => void;
  onClick?: (event: MapPointerEvent) => void;
  onContextMenu?: (event: MapPointerEvent) => void;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export const MapView = ({
  styleUrl,
  initialView,
  projection,
  attribution,
  cursor,
  onLoad,
  onMoveStart,
  onMoveEnd,
  onZoomStart,
  onZoom,
  onZoomEnd,
  onDragStart,
  onWheel,
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
      {...(projection !== undefined ? { projection: toAdapterProjection(projection) } : {})}
      {...(attribution !== undefined
        ? { attributionControl: toAdapterAttribution(attribution) }
        : {})}
      {...(cursor !== undefined ? { cursor } : {})}
      {...(className !== undefined ? { className } : {})}
      {...(style !== undefined ? { style } : {})}
      onLoad={(event) => {
        const map = toMapInstance(event.target);
        if (attribution !== undefined && attribution !== false && attribution.collapsed) {
          collapseAttribution(map.getContainer());
        }
        onLoad?.(map);
      }}
      onMoveStart={(event) => {
        onMoveStart?.(toCameraView(event));
      }}
      onMoveEnd={(event) => {
        onMoveEnd?.(toCameraView(event));
      }}
      onZoomStart={(event) => {
        onZoomStart?.(toCameraView(event));
      }}
      onZoom={(event) => {
        onZoom?.(toCameraView(event));
      }}
      onZoomEnd={(event) => {
        onZoomEnd?.(toCameraView(event));
      }}
      onDragStart={(event) => {
        onDragStart?.(toCameraView(event));
      }}
      onWheel={(event) => {
        onWheel?.({ type: "wheel", originalEvent: event.originalEvent });
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

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The standard on-map controls. They carry no options of their own beyond where
 * they sit: what each one does is the provider's business, and a caller that
 * needed to restyle them would be reaching past the port.
 */
export type MapControlProps = {
  /** Defaults to the provider's usual corner for that control. */
  position?: MapControlPosition;
};

/** Zoom buttons and a compass. */
export const NavigationControl = ({ position }: MapControlProps): React.JSX.Element => (
  <AdapterNavigationControl {...(position !== undefined ? { position } : {})} />
);

/** Centres the map on the reader's own position, once they allow it. */
export const GeolocateControl = ({ position }: MapControlProps): React.JSX.Element => (
  <AdapterGeolocateControl {...(position !== undefined ? { position } : {})} />
);

/** A distance bar for the current zoom. */
export const ScaleControl = ({ position }: MapControlProps): React.JSX.Element => (
  <AdapterScaleControl {...(position !== undefined ? { position } : {})} />
);

/** Expands the map to fill the screen. */
export const FullscreenControl = ({ position }: MapControlProps): React.JSX.Element => (
  <AdapterFullscreenControl {...(position !== undefined ? { position } : {})} />
);

export type MarkerProps = {
  at: LngLat;
  anchor?: MarkerAnchor;
  /** Applied to the marker's own element, on top of the provider's styling. */
  style?: React.CSSProperties;
  /**
   * Fired when the marker's element is clicked. It runs before the map's own
   * click handling, so `originalEvent.stopPropagation()` keeps a click on a
   * marker from also reading as a click on the map beneath it.
   */
  onClick?: (event: { originalEvent: MouseEvent }) => void;
  children: React.ReactNode;
};

/**
 * A single DOM marker — for the small, rich case (a photo thumbnail, a pin with
 * its own interactions). Bulk data belongs in `<DataLayer>`.
 */
export const Marker = ({
  at,
  anchor,
  style,
  onClick,
  children,
}: MarkerProps): React.JSX.Element => (
  <AdapterMarker
    longitude={at.lng}
    latitude={at.lat}
    {...(anchor !== undefined ? { anchor } : {})}
    {...(style !== undefined ? { style } : {})}
    {...(onClick !== undefined
      ? {
          onClick: (event: { originalEvent: MouseEvent }) =>
            onClick({ originalEvent: event.originalEvent }),
        }
      : {})}
  >
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

type PointProperties = { id: string; color?: string; radius?: number; opacity?: number };
type LineProperties = {
  id: string;
  color: string;
  width: number;
  opacity?: number;
  blur?: number;
  /** Identifies the dash group a line belongs to; absent means solid. */
  dashKey?: string;
};

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
        ...(point.opacity !== undefined ? { opacity: point.opacity } : {}),
      },
      geometry: { type: "Point", coordinates: [point.at.lng, point.at.lat] },
    }),
  ),
});

/** Names a dash pattern, so features and their layer can be matched up. */
const dashKey = (dash: readonly number[]): string => dash.join("-");

const toLineCollection = (
  lines: readonly LineFeature[],
): FeatureCollection<LineString, LineProperties> => ({
  type: "FeatureCollection",
  features: lines.map(
    (line): Feature<LineString, LineProperties> => ({
      type: "Feature",
      id: line.id,
      properties: {
        id: line.id,
        color: line.color,
        width: line.width,
        ...(line.opacity !== undefined ? { opacity: line.opacity } : {}),
        ...(line.blur !== undefined ? { blur: line.blur } : {}),
        ...(line.dash ? { dashKey: dashKey(line.dash) } : {}),
      },
      geometry: {
        type: "LineString",
        coordinates: line.path.map((at) => [at.lng, at.lat]),
      },
    }),
  ),
});

type CirclePaint = NonNullable<Extract<LayerProps, { type: "circle" }>["paint"]>;

/**
 * Colour, radius, and opacity are read off each feature so one layer can draw a
 * whole set of differently styled points — that is what keeps bulk data on the
 * GPU. The halo, if asked for, is uniform across the layer.
 */
const circlePaint = (stroke: PointStroke | undefined): CirclePaint => ({
  "circle-color": ["coalesce", ["get", "color"], DEFAULT_POINT_COLOUR],
  "circle-radius": ["coalesce", ["get", "radius"], DEFAULT_POINT_RADIUS],
  "circle-opacity": ["coalesce", ["get", "opacity"], 1],
  ...(stroke
    ? {
        "circle-stroke-color": stroke.color,
        "circle-stroke-width": stroke.width,
        // The halo fades with its point, so a de-emphasised point does not keep
        // a fully opaque ring around it.
        "circle-stroke-opacity": ["coalesce", ["get", "opacity"], 1],
      }
    : {}),
});

const circleLayer = (
  id: string,
  clustered: boolean,
  stroke: PointStroke | undefined,
): LayerProps =>
  clustered
    ? {
        id: `${id}-point-circles`,
        type: "circle",
        filter: ["!", ["has", "point_count"]],
        paint: circlePaint(stroke),
      }
    : {
        id: `${id}-point-circles`,
        type: "circle",
        paint: circlePaint(stroke),
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

type LineLayer = Extract<LayerProps, { type: "line" }>;
type LineWidth = NonNullable<NonNullable<LineLayer["paint"]>["line-width"]>;

/**
 * A taper is measured along each line's own length, so it is one expression for
 * the whole layer rather than a value per feature. Without one the width is read
 * off each feature as usual.
 */
const lineWidth = (widthAlong: readonly LineWidthStop[] | undefined): LineWidth =>
  widthAlong
    ? [
        "interpolate",
        ["linear"],
        ["line-progress"],
        ...widthAlong.flatMap((stop) => [stop.at, stop.width]),
      ]
    : ["get", "width"];

/**
 * Colour, width, opacity, and blur are read off each feature, but a dash pattern
 * cannot be — no GL provider varies one within a drawn layer. So lines are
 * grouped by pattern and each group gets a layer of its own, in the order the
 * patterns first appear, which keeps the caller's drawing order intact.
 */
const lineLayers = (
  id: string,
  lines: readonly LineFeature[],
  widthAlong: readonly LineWidthStop[] | undefined,
): LayerProps[] => {
  const fades = lines.some((line) => line.opacity !== undefined);
  const blurs = lines.some((line) => line.blur !== undefined);

  const patterns: Array<number[] | null> = [];
  for (const line of lines) {
    const key = line.dash ? dashKey(line.dash) : null;
    if (!patterns.some((pattern) => (pattern ? dashKey(pattern) : null) === key)) {
      patterns.push(line.dash ?? null);
    }
  }
  // With a single pattern every feature belongs to the one layer, so no filter
  // is needed — and the common case stays a single draw.
  const split = patterns.length > 1;

  return patterns.map((pattern): LayerProps => {
    const key = pattern ? dashKey(pattern) : null;
    const filter: LineLayer["filter"] =
      key === null ? ["!", ["has", "dashKey"]] : ["==", ["get", "dashKey"], key];

    return {
      id: key === null ? `${id}-line-strokes` : `${id}-line-strokes-${key}`,
      type: "line",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": lineWidth(widthAlong),
        ...(fades ? { "line-opacity": ["coalesce", ["get", "opacity"], 1] } : {}),
        ...(blurs ? { "line-blur": ["coalesce", ["get", "blur"], 0] } : {}),
        ...(pattern ? { "line-dasharray": pattern } : {}),
      },
      ...(split ? { filter } : {}),
    };
  });
};

/**
 * The parts of an engine feature event this binding reads. Structural, for the
 * same reason as the pointer events above.
 */
type EngineFeatureEvent = {
  lngLat: { lng: number; lat: number };
  features?: { properties?: Record<string, unknown> | null }[] | undefined;
};

const toPointHit = (event: EngineFeatureEvent): PointFeatureHit | null => {
  // The topmost feature is the one under the pointer; the rest are behind it.
  const id = event.features?.[0]?.properties?.id;

  return typeof id === "string" ? { id, at: toLngLat(event.lngLat) } : null;
};

/**
 * Points drawn on the GPU have no DOM node to listen on, so interaction is
 * subscribed on the layer itself. This is what lets bulk data stay clickable
 * without giving every feature an element.
 */
const usePointInteractions = (
  layerId: string,
  onPointClick: ((point: PointFeatureHit) => void) | undefined,
  onPointHover: ((point: PointFeatureHit | null) => void) | undefined,
): void => {
  const { current: map } = useAdapterMap();
  // Read through a ref so a caller's inline arrow does not resubscribe the map
  // on every render — the point of this path is to stop doing per-frame work.
  const handlersRef = React.useRef({ onPointClick, onPointHover });
  handlersRef.current = { onPointClick, onPointHover };
  const wantsClick = onPointClick !== undefined;
  const wantsHover = onPointHover !== undefined;

  React.useEffect(() => {
    if (!map || (!wantsClick && !wantsHover)) {
      return;
    }

    let hoveredId: string | null = null;
    const handleClick = (event: EngineFeatureEvent) => {
      const hit = toPointHit(event);
      if (hit) {
        handlersRef.current.onPointClick?.(hit);
      }
    };
    const handleMove = (event: EngineFeatureEvent) => {
      const hit = toPointHit(event);
      if (!hit || hit.id === hoveredId) {
        return;
      }

      hoveredId = hit.id;
      handlersRef.current.onPointHover?.(hit);
    };
    const handleLeave = () => {
      if (hoveredId === null) {
        return;
      }

      hoveredId = null;
      handlersRef.current.onPointHover?.(null);
    };

    if (wantsClick) {
      map.on("click", layerId, handleClick);
    }
    if (wantsHover) {
      map.on("mousemove", layerId, handleMove);
      map.on("mouseleave", layerId, handleLeave);
    }

    return () => {
      if (wantsClick) {
        map.off("click", layerId, handleClick);
      }
      if (wantsHover) {
        map.off("mousemove", layerId, handleMove);
        map.off("mouseleave", layerId, handleLeave);
        handleLeave();
      }
    };
  }, [map, layerId, wantsClick, wantsHover]);
};

export type DataLayerProps = {
  /** Prefixes the source and layer ids this layer owns. */
  id: string;
  points?: readonly PointFeature[];
  lines?: readonly LineFeature[];
  /** Groups nearby points into counted clusters at low zoom. */
  cluster?: boolean;
  /** A halo around every point. Omitted, points are drawn without one. */
  stroke?: PointStroke;
  /**
   * Tapers every line in the layer, widths interpolated between stops measured
   * along each line's own length. Like `stroke` it is uniform across the layer:
   * a provider cannot vary a taper between features it draws in one pass.
   */
  lineWidthAlong?: readonly LineWidthStop[];
  /** Fired when a point — never a cluster — is clicked. */
  onPointClick?: (point: PointFeatureHit) => void;
  /** Fired with the point the pointer moved onto, and `null` when it leaves. */
  onPointHover?: (point: PointFeatureHit | null) => void;
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
  stroke,
  lineWidthAlong,
  onPointClick,
  onPointHover,
}: DataLayerProps): React.JSX.Element => {
  const pointData = React.useMemo(() => (points ? toPointCollection(points) : null), [points]);
  // Data and layers are derived together: the layers depend on which dash
  // patterns the data uses, and memoising both keeps a re-render from looking
  // like a style change to the adapter.
  const lineDraw = React.useMemo(
    () =>
      lines
        ? { data: toLineCollection(lines), layers: lineLayers(id, lines, lineWidthAlong) }
        : null,
    [id, lines, lineWidthAlong],
  );

  usePointInteractions(`${id}-point-circles`, onPointClick, onPointHover);

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
          <Layer {...circleLayer(id, cluster, stroke)} />
        </Source>
      ) : null}
      {lineDraw ? (
        <Source
          id={`${id}-lines`}
          type="geojson"
          data={lineDraw.data}
          // A taper is expressed as a fraction along each line, which the
          // provider can only measure if it is asked to.
          {...(lineWidthAlong !== undefined ? { lineMetrics: true } : {})}
        >
          {lineDraw.layers.map((layer) => (
            <Layer key={layer.id} {...layer} />
          ))}
        </Source>
      ) : null}
    </>
  );
};
