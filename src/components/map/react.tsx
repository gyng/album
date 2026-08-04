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
  type MapRef,
  Marker as AdapterMarker,
  NavigationControl as AdapterNavigationControl,
  PointRelief as AdapterPointRelief,
  Popup as AdapterPopup,
  ScaleControl as AdapterScaleControl,
  Source,
  useMap as useAdapterMap,
  useSourceGeneration,
} from "./adapters/maplibre";
import { DEFAULT_CLUSTER_LABEL_FONT, DEFAULT_POINT_COLOUR, DEFAULT_POINT_RADIUS } from "./port";
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
  MapEventMap,
  MapEventName,
  MapInstance,
  MapPointerEvent,
  MapProjectionMode,
  MapWheelEvent,
  MarkerAnchor,
  PointFeature,
  PointFeatureHit,
  PointStroke,
  ReliefField,
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

const subscribe = <Name extends MapEventName>(
  map: MapRef,
  event: Name,
  listener: (event: MapEventMap[Name]) => void,
): (() => void) => {
  // Each branch below builds the payload `MapEventMap` pairs with the names it
  // handles: the literals are checked against `MapEvent`, and each carries its
  // own name as `type`, so a branch cannot quietly emit another branch's shape.
  // That is what the widening here rests on — `emit` is only ever called with
  // the variant belonging to `event`. The assertion lives beside the code that
  // upholds it rather than at the call site, which cannot see the branches.
  const emit = listener as (event: MapEvent) => void;

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
        ...(options?.pitch !== undefined ? { pitch: options.pitch } : {}),
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
  on: (event, listener) => subscribe(map, event, listener),
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
  /**
   * `pitch` and `bearing` are what make a style with building extrusions look
   * like anything: a pitched camera is the whole of what "3D" means for a
   * basemap that draws its buildings with height.
   */
  initialView?: { center?: LngLat; zoom?: number; pitch?: number; bearing?: number };
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
  const pitch = initialView?.pitch;
  const bearing = initialView?.bearing;

  return (
    <AdapterMap
      mapStyle={styleUrl}
      initialViewState={{
        ...(center ? { longitude: center.lng, latitude: center.lat } : {}),
        ...(zoom !== undefined ? { zoom } : {}),
        ...(pitch !== undefined ? { pitch } : {}),
        ...(bearing !== undefined ? { bearing } : {}),
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
  /** Where the popup points, on the ground. */
  at: LngLat;
  /**
   * Pixels between `at` and the popup's tip, so it can clear whatever it is
   * pointing at. Omitted, the provider's own spacing stands.
   */
  offset?: number;
  /**
   * Draws the provider's own dismiss button. Off by default: most popups here
   * are opened and shut by the thing that opened them, and a second way to
   * close one is a second piece of state to keep straight.
   */
  showCloseButton?: boolean;
  /**
   * Dismisses the popup when the map surface is clicked. Off by default, and
   * deliberately so: providers close on the same click the application is still
   * handling, so a popup opened *by* that click reports itself dismissed
   * immediately and takes the caller's selection with it. A caller that wants
   * click-away dismissal owns it in its own map click handler, where it can
   * sequence dismissal against its own state.
   */
  dismissOnMapClick?: boolean;
  /** Applied to the popup's own element, on top of the provider's styling. */
  className?: string;
  /**
   * Fired when the popup dismisses itself — its close button, or a map click
   * when `dismissOnMapClick` is set. Unmounting is not a dismissal, so a popup
   * the caller stops rendering does not report one back.
   */
  onDismiss?: () => void;
  children: React.ReactNode;
};

export const Popup = ({
  at,
  offset,
  showCloseButton = false,
  dismissOnMapClick = false,
  className,
  onDismiss,
  children,
}: PopupProps): React.JSX.Element => (
  <AdapterPopup
    longitude={at.lng}
    latitude={at.lat}
    // Both are passed whatever the caller said, because the port's defaults are
    // not the provider's: leaving them out would hand back MapLibre's `true`.
    closeButton={showCloseButton}
    closeOnClick={dismissOnMapClick}
    {...(offset !== undefined ? { offset } : {})}
    {...(className !== undefined ? { className } : {})}
    {...(onDismiss !== undefined
      ? {
          onClose: () => {
            onDismiss();
          },
        }
      : {})}
  >
    {children}
  </AdapterPopup>
);

/* -------------------------------------------------------------------------- */
/* DataLayer                                                                   */
/* -------------------------------------------------------------------------- */

const CLUSTER_MAX_ZOOM = 12;
const CLUSTER_RADIUS = 42;

/* -------------------------------------------------------------------------- */
/* Style construction                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The style vocabulary this module writes, declared structurally so the port
 * does not lean on the provider's own type surface. A value is either a literal
 * or a nested expression the provider evaluates per feature.
 *
 * Authoring style-spec here at all is a known leak — the plan
 * (`docs/plan-003-map-abstraction.md`) puts this translation in the adapter, and
 * relocating it needs the adapter to accept a neutral layer description. Until
 * then it is at least written against types this file owns.
 */
type StyleValue = string | number | boolean | readonly StyleValue[];
type StyleExpression = readonly StyleValue[];
type StyleProperties = Readonly<Record<string, StyleValue>>;

/** A drawn layer, as the provider's style document describes one. */
type LayerSpec = {
  id: string;
  type: "circle" | "line" | "symbol";
  filter?: StyleExpression;
  layout?: StyleProperties;
  paint?: StyleProperties;
};

/**
 * The one point where a layer description crosses into the adapter. The
 * provider validates the spec it is handed at runtime, so this assertion is the
 * seam between the types this module owns and the provider's own — not a claim
 * that the two happen to line up.
 */
const StyleLayer = Layer as unknown as React.ComponentType<LayerSpec>;

type PointProperties = {
  id: string;
  color?: string;
  radius?: number;
  opacity?: number;
  sortKey?: number;
};
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
        ...(point.sortKey !== undefined ? { sortKey: point.sortKey } : {}),
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

/**
 * Colour, radius, and opacity are read off each feature so one layer can draw a
 * whole set of differently styled points — that is what keeps bulk data on the
 * GPU. The halo, if asked for, is uniform across the layer.
 */
const circlePaint = (stroke: PointStroke | undefined): StyleProperties => ({
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

// Overlap within one layer is resolved by `sortKey`, not by feature order:
// nothing promises a provider draws a collection in the order it was handed,
// so a point that must sit on top has to say so with a value.
const circleLayout = (): StyleProperties => ({
  "circle-sort-key": ["coalesce", ["get", "sortKey"], 0],
});

const circleLayer = (id: string, clustered: boolean, stroke: PointStroke | undefined): LayerSpec =>
  clustered
    ? {
        id: `${id}-point-circles`,
        type: "circle",
        filter: ["!", ["has", "point_count"]],
        layout: circleLayout(),
        paint: circlePaint(stroke),
      }
    : {
        id: `${id}-point-circles`,
        type: "circle",
        layout: circleLayout(),
        paint: circlePaint(stroke),
      };

const clusterLayer = (id: string): LayerSpec => ({
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

const clusterLabelLayer = (id: string, font: readonly string[]): LayerSpec => ({
  id: `${id}-cluster-labels`,
  type: "symbol",
  filter: ["has", "point_count"],
  layout: {
    "text-field": ["get", "point_count"],
    "text-size": 12,
    // A provider letters only with faces its style ships glyphs for, and draws
    // nothing at all when asked for one it has not got — so the face is part of
    // the layer's contract, not a detail. See `DEFAULT_CLUSTER_LABEL_FONT`.
    "text-font": font,
  },
  paint: {
    "text-color": "rgba(0, 0, 0, 0.9)",
    "text-halo-color": "rgba(255, 255, 255, 0.96)",
    "text-halo-width": 1.2,
    "text-halo-blur": 0.4,
  },
});

/**
 * Puts a caller's taper stops in the shape a provider will accept: positions
 * clamped to the line they are measured along, in ascending order, and each
 * position appearing once.
 *
 * Providers interpolate over strictly ascending inputs and reject the whole
 * layer otherwise — the line simply never draws. A caller deriving stops from
 * data should not have to know that, so the tidying happens here rather than
 * being left as a trap. Where two stops land on the same position (which
 * clamping can cause on its own) the first one given wins, and a position that
 * is not a real number cannot be placed at all, so it is dropped.
 *
 * A taper needs two positions to interpolate between, and clamping and
 * de-duplication can leave a caller's stops with fewer — so anything that
 * describes no taper comes back as none at all, rather than as a lone stop the
 * provider would have to make sense of on its own.
 */
const toTaperStops = (stops: readonly LineWidthStop[]): LineWidthStop[] => {
  const ordered = stops
    .filter((stop) => Number.isFinite(stop.at))
    .map((stop) => ({ at: Math.min(Math.max(stop.at, 0), 1), width: stop.width }))
    .sort((a, b) => a.at - b.at);

  const ascending: LineWidthStop[] = [];
  for (const stop of ordered) {
    const previous = ascending.at(-1);
    if (!previous || stop.at > previous.at) {
      ascending.push(stop);
    }
  }

  return ascending.length < 2 ? [] : ascending;
};

/**
 * A taper is measured along each line's own length, so it is one expression for
 * the whole layer rather than a value per feature. Without one — or with stops
 * that did not describe a taper — the width is read off each feature as usual.
 *
 * Two stops is the floor, not one: interpolating needs something to interpolate
 * between, and a provider handed a one-stop `interpolate` is not reliably
 * willing to accept it. `toTaperStops` already refuses to hand one over, and
 * this is the guard on the expression itself.
 */
const lineWidth = (widthAlong: readonly LineWidthStop[]): StyleExpression =>
  widthAlong.length >= 2
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
  widthAlong: readonly LineWidthStop[],
): LayerSpec[] => {
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

  return patterns.map((pattern): LayerSpec => {
    const key = pattern ? dashKey(pattern) : null;
    const filter: StyleExpression =
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

/* -------------------------------------------------------------------------- */
/* Stacking                                                                    */
/* -------------------------------------------------------------------------- */

/** One `<DataLayer>` group's layers, and where its caller wants them drawn. */
type StackEntry = {
  /** Higher draws on top. `undefined` is "no opinion". */
  order: number | undefined;
  /**
   * Mount sequence, so groups that express no preference keep mount order. Taken
   * once per mounted group and kept across re-registrations: a group whose
   * source is rebuilt must not thereby overtake a peer that declared the same
   * order, or the drawing order would depend on rebuild history — the very
   * thing this stacking exists to stop.
   */
  seq: number;
  /**
   * Kind of layer: points (0) draw beneath lines (1).
   *
   * Decided ahead of `seq`, because mount order does not say this. A layer's
   * points and lines live on two sources, and either can be rebuilt on its own
   * — a points source that is rebuilt (or that only appears once the layer is
   * given points) re-adds its layers on top, which is the contract inverted.
   *
   * It sorts across every entry at the same `order`, not only the two halves of
   * one `<DataLayer>`: two different layers declaring the same order — one
   * lines-only, one points-only — have the points put below the lines whatever
   * they declared or whichever mounted first. No such pair exists today; a
   * caller wanting one over the other should give them different orders.
   *
   * It applies whenever *any* entry on the map declares an `order` — see
   * `restack`, which then restacks every entry, order-less ones included. Only
   * a map where nobody declares one is left exactly as the provider appended it.
   */
  group: number;
  ids: readonly string[];
};

/** The stacking groups registered against each map. */
const stacks = new WeakMap<MapRef, Set<StackEntry>>();
let stackSeq = 0;

const byStackOrder = (a: StackEntry, b: StackEntry): number =>
  (a.order ?? 0) - (b.order ?? 0) || a.group - b.group || a.seq - b.seq;

/**
 * Re-applies the stack in declared order, bottom group first — raising each
 * group in turn leaves the last one on top.
 *
 * Providers append a layer as it is added, so without this the stacking depends
 * on which layer happened to mount last: one branch of a tree remounting puts
 * its layers above everything mounted before it, and the same tree draws
 * differently depending on what the reader did on the way there.
 *
 * Nothing moves while no group has declared an `order`. Equal orders express no
 * preference, and mount order is already what the provider has, so a map whose
 * callers say nothing behaves exactly as it did.
 */
const restack = (map: MapRef, entries: ReadonlySet<StackEntry>): void => {
  const groups = [...entries];
  if (!groups.some((entry) => entry.order !== undefined)) {
    return;
  }

  // A group registers once its own layers are added, but another group's may
  // not be there yet — or may have gone with a style reload.
  const wanted = groups
    .sort(byStackOrder)
    .flatMap((entry) => entry.ids.filter((layerId) => Boolean(map.getLayer(layerId))));

  // Raising a layer marks the style changed, and every `<Source>` and `<Layer>`
  // on the map hears that and re-renders, so a pass that would move nothing is
  // not worth making. Raising each group in turn leaves all of them on top in
  // `wanted` order, so the style already ending in exactly that run means the
  // stack is applied and there is nothing to do.
  const drawn = map.getLayersOrder();
  const tail = drawn.slice(drawn.length - wanted.length);
  if (tail.length === wanted.length && wanted.every((layerId, at) => tail[at] === layerId)) {
    return;
  }

  for (const layerId of wanted) {
    map.moveLayer(layerId);
  }
};

/**
 * Registers a group of layers for stacking, and re-applies the stack whenever
 * the registered set changes or the layers themselves are put back on the map.
 *
 * Rendered as the last child of the source that owns the layers, which is what
 * makes the timing work: React runs effects depth-first in tree order, so the
 * layers rendered above this element have already added themselves by the time
 * this effect runs and there is something to move.
 *
 * The source's `generation` is a dependency for the same reason the layers
 * themselves watch it. A provider appends a layer as it is added, so a group
 * whose layers are re-added lands on top of everything — and they are re-added
 * whenever the source is, either because an option MapLibre only reads at
 * construction changed or because the whole style reloaded under the map.
 * Applying the stack once at mount would silently revert the first time either
 * happened. The generation is bumped in the same commit the layers re-add
 * themselves in, so watching it restacks exactly then and never in between;
 * watching the style version instead would run a pass on every style mutation,
 * including the ones this component's own `moveLayer` calls cause.
 */
const StackOrder = ({
  order,
  group,
  ids,
}: {
  order?: number;
  group: number;
  ids: readonly string[];
}): null => {
  const { current: map } = useAdapterMap();
  const generation = useSourceGeneration();
  // Taken on the first registration and kept afterwards — see `StackEntry.seq`.
  // Assigned from the effect rather than during render, so a render React
  // abandons cannot burn a sequence number.
  const seqRef = React.useRef(0);
  // The ids are rebuilt every render, so the effect keys off their names.
  const idKey = ids.join("\u0000");
  const idsRef = React.useRef(ids);
  idsRef.current = ids;

  React.useEffect(() => {
    if (!map) {
      return;
    }

    if (seqRef.current === 0) {
      stackSeq += 1;
      seqRef.current = stackSeq;
    }
    const entry: StackEntry = { order, seq: seqRef.current, group, ids: idsRef.current };
    const entries = stacks.get(map) ?? new Set<StackEntry>();
    stacks.set(map, entries);
    entries.add(entry);
    restack(map, entries);

    return () => {
      entries.delete(entry);
      restack(map, entries);
    };
  }, [map, order, group, idKey, generation]);

  return null;
};

export type DataLayerProps = {
  /** Prefixes the source and layer ids this layer owns. */
  id: string;
  points?: readonly PointFeature[];
  lines?: readonly LineFeature[];
  /** Groups nearby points into counted clusters at low zoom. */
  cluster?: boolean;
  /**
   * The face a cluster's count is lettered in, named as the style's glyph set
   * spells it. Defaults to `DEFAULT_CLUSTER_LABEL_FONT`, which the styles this
   * site uses provide; a style without that face draws no count at all, so any
   * other one has to name its own.
   */
  clusterLabelFont?: readonly string[];
  /** A halo around every point. Omitted, points are drawn without one. */
  stroke?: PointStroke;
  /**
   * Where this layer's drawing sits relative to the other `<DataLayer>`s on the
   * same map: higher draws on top, whatever order they happened to mount in.
   *
   * Layers that leave it out keep mount order relative to each other, and a map
   * where nobody declares one is left exactly as the provider stacked it — so
   * this is opt-in per map, and worth opting into wherever a layer can mount,
   * unmount, and mount again while its neighbours stay put.
   */
  order?: number;
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
  clusterLabelFont = DEFAULT_CLUSTER_LABEL_FONT,
  stroke,
  lineWidthAlong,
  order,
  onPointClick,
  onPointHover,
}: DataLayerProps): React.JSX.Element => {
  const pointData = React.useMemo(() => (points ? toPointCollection(points) : null), [points]);
  const taper = React.useMemo(
    () => (lineWidthAlong ? toTaperStops(lineWidthAlong) : []),
    [lineWidthAlong],
  );
  // Data and layers are derived together: the layers depend on which dash
  // patterns the data uses, and memoising both keeps a re-render from looking
  // like a style change to the adapter.
  const lineDraw = React.useMemo(
    () => (lines ? { data: toLineCollection(lines), layers: lineLayers(id, lines, taper) } : null),
    [id, lines, taper],
  );
  const pointLayerIds = React.useMemo(
    () =>
      cluster
        ? [`${id}-clusters`, `${id}-cluster-labels`, `${id}-point-circles`]
        : [`${id}-point-circles`],
    [id, cluster],
  );
  const lineLayerIds = React.useMemo(
    () => lineDraw?.layers.map((layer) => layer.id) ?? [],
    [lineDraw],
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
          {cluster ? <StyleLayer {...clusterLayer(id)} /> : null}
          {cluster ? <StyleLayer {...clusterLabelLayer(id, clusterLabelFont)} /> : null}
          <StyleLayer {...circleLayer(id, cluster, stroke)} />
          <StackOrder group={0} ids={pointLayerIds} {...(order !== undefined ? { order } : {})} />
        </Source>
      ) : null}
      {lineDraw ? (
        <Source
          id={`${id}-lines`}
          type="geojson"
          data={lineDraw.data}
          // A taper is expressed as a fraction along each line, which the
          // provider can only measure if it is asked to.
          {...(taper.length > 0 ? { lineMetrics: true } : {})}
        >
          {lineDraw.layers.map((layer) => (
            <StyleLayer key={layer.id} {...layer} />
          ))}
          <StackOrder group={1} ids={lineLayerIds} {...(order !== undefined ? { order } : {})} />
        </Source>
      ) : null}
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Relief                                                                      */
/* -------------------------------------------------------------------------- */

export type ReliefProps = ReliefField & { id?: string };

/**
 * Ground that rises around the data on it.
 *
 * The map is given points and how tall they should stand; whether that becomes
 * real terrain, a shaded relief or nothing at all is the renderer's business.
 * MapLibre's answer is elevation tiles synthesised in the browser — see the
 * adapter — but nothing above this line knows that.
 */
export const Relief = ({
  id,
  points,
  radiusMetres,
  peakMetres,
  ceilingMetres,
  exaggeration,
}: ReliefProps): React.JSX.Element => (
  <AdapterPointRelief
    {...(id === undefined ? {} : { id })}
    points={points}
    {...(radiusMetres === undefined ? {} : { radiusMetres })}
    {...(peakMetres === undefined ? {} : { peakMetres })}
    {...(ceilingMetres === undefined ? {} : { ceilingMetres })}
    {...(exaggeration === undefined ? {} : { exaggeration })}
  />
);
