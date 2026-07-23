import React from "react";
import { gl } from "./engine";
import type {
  AttributionControlOptions,
  LngLatBoundsLike,
  MapLibreEvent,
  MapMouseEvent,
  MapOptions,
  MapWheelEvent,
  ProjectionSpecification,
  StyleSpecification,
} from "./engine";
import { MapContext, type MapContextValue } from "./context";
import { installVendoredWorker } from "./worker";
import {
  type MapRef,
  toViewStateChangeEvent,
  type ViewState,
  type ViewStateChangeEvent,
} from "./types";

/** Matches MapLibre's own resize debounce, so resize behaviour is unchanged. */
const RESIZE_DEBOUNCE_MS = 50;

type CameraHandler = ((event: ViewStateChangeEvent) => void) | undefined;

export type MapViewProps = {
  /** A style-spec URL or an inline style document. */
  mapStyle?: string | StyleSpecification;
  /** Read once, at construction — the camera is uncontrolled after that. */
  initialViewState?: Partial<ViewState>;
  attributionControl?: false | AttributionControlOptions;
  projection?: ProjectionSpecification | "mercator" | "globe";
  /** CSS cursor applied to the map canvas. */
  cursor?: string;
  interactive?: boolean;
  scrollZoom?: boolean;
  dragPan?: boolean;
  cooperativeGestures?: boolean;
  minZoom?: number;
  maxZoom?: number;
  maxBounds?: LngLatBoundsLike;
  renderWorldCopies?: boolean;
  /** Container id, class and inline style. */
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  onLoad?: (event: MapLibreEvent) => void;
  onMoveStart?: (event: ViewStateChangeEvent) => void;
  onMove?: (event: ViewStateChangeEvent) => void;
  onMoveEnd?: (event: ViewStateChangeEvent) => void;
  onZoomStart?: (event: ViewStateChangeEvent) => void;
  onZoom?: (event: ViewStateChangeEvent) => void;
  onZoomEnd?: (event: ViewStateChangeEvent) => void;
  onDragStart?: (event: ViewStateChangeEvent) => void;
  onDrag?: (event: ViewStateChangeEvent) => void;
  onDragEnd?: (event: ViewStateChangeEvent) => void;
  onWheel?: (event: MapWheelEvent) => void;
  onClick?: (event: MapMouseEvent) => void;
  onContextMenu?: (event: MapMouseEvent) => void;
};

const toProjectionSpec = (
  projection: ProjectionSpecification | "mercator" | "globe",
): ProjectionSpecification => (typeof projection === "string" ? { type: projection } : projection);

const buildMapOptions = (container: HTMLElement, props: MapViewProps): MapOptions => {
  const view = props.initialViewState ?? {};
  const options: MapOptions = {
    container,
    center: [view.longitude ?? 0, view.latitude ?? 0],
    zoom: view.zoom ?? 0,
    bearing: view.bearing ?? 0,
    pitch: view.pitch ?? 0,
    // The adapter owns container resizing (see the ResizeObserver below), so a
    // size change is applied once rather than once here and once by MapLibre.
    trackResize: false,
  };

  // Optional options are omitted rather than set to `undefined`: MapLibre reads
  // several of them with a presence check rather than a nullish check.
  if (props.mapStyle !== undefined) {
    options.style = props.mapStyle;
  }
  if (props.attributionControl !== undefined) {
    options.attributionControl = props.attributionControl;
  }
  if (props.interactive !== undefined) {
    options.interactive = props.interactive;
  }
  if (props.scrollZoom !== undefined) {
    options.scrollZoom = props.scrollZoom;
  }
  if (props.dragPan !== undefined) {
    options.dragPan = props.dragPan;
  }
  if (props.cooperativeGestures !== undefined) {
    options.cooperativeGestures = props.cooperativeGestures;
  }
  if (props.minZoom !== undefined) {
    options.minZoom = props.minZoom;
  }
  if (props.maxZoom !== undefined) {
    options.maxZoom = props.maxZoom;
  }
  if (props.maxBounds !== undefined) {
    options.maxBounds = props.maxBounds;
  }
  if (props.renderWorldCopies !== undefined) {
    options.renderWorldCopies = props.renderWorldCopies;
  }

  return options;
};

const MapViewImpl = (
  props: MapViewProps,
  ref: React.ForwardedRef<MapRef | null>,
): React.JSX.Element => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapRef | null>(null);
  // Listeners are registered once and read the latest props through this ref,
  // so a re-render never has to tear listeners down and add them back.
  const propsRef = React.useRef(props);
  propsRef.current = props;
  // Seeded with the style the map is constructed from, so the first pass of the
  // style effect does not reload an identical style.
  const appliedStyleRef = React.useRef(props.mapStyle);

  const [readyMap, setReadyMap] = React.useState<MapRef | null>(null);

  React.useEffect(() => {
    // SSR guard: there is no DOM to render a WebGL map into.
    if (typeof window === "undefined") {
      return;
    }

    const container = containerRef.current;
    // StrictMode double-mount guard: a second invocation must not build a
    // second map into the same container.
    if (!container || mapRef.current) {
      return;
    }

    // Constructing the map is fallible: MapLibre throws "Failed to initialize
    // WebGL" whenever the browser cannot hand it a GL context — a machine with
    // no GL driver, a headless browser, a blocked or exhausted context, or a
    // user who has turned WebGL off. That is a degraded map, not a broken
    // application, so the failure is contained here: letting it escape a
    // `useEffect` would surface it to the nearest error boundary and take the
    // whole page down with it.
    let map: MapRef;
    try {
      installVendoredWorker();
      map = new gl.Map(buildMapOptions(container, propsRef.current));
    } catch (error) {
      console.error(error);

      return;
    }
    mapRef.current = map;

    const emitCamera =
      (type: ViewStateChangeEvent["type"], pick: (props: MapViewProps) => CameraHandler) =>
      (event: MapLibreEvent<MouseEvent | TouchEvent | WheelEvent | undefined>) => {
        pick(propsRef.current)?.(toViewStateChangeEvent(type, map, event.originalEvent));
      };

    const onLoad = (event: MapLibreEvent) => {
      // Children mount only once the style is in place, so sources, layers,
      // markers and popups never touch an unready map.
      setReadyMap(map);
      propsRef.current.onLoad?.(event);
    };
    const applyProjection = () => {
      const projection = propsRef.current.projection;
      if (projection === undefined) {
        return;
      }
      const next = toProjectionSpec(projection);
      // Setting the projection mutates the style, which fires `styledata`
      // again — compare first so re-applying cannot loop.
      if (JSON.stringify(map.getProjection()?.type) === JSON.stringify(next.type)) {
        return;
      }
      map.setProjection(next);
    };
    const onMoveStart = emitCamera("movestart", (current) => current.onMoveStart);
    const onMove = emitCamera("move", (current) => current.onMove);
    const onMoveEnd = emitCamera("moveend", (current) => current.onMoveEnd);
    const onZoomStart = emitCamera("zoomstart", (current) => current.onZoomStart);
    const onZoom = emitCamera("zoom", (current) => current.onZoom);
    const onZoomEnd = emitCamera("zoomend", (current) => current.onZoomEnd);
    const onDragStart = emitCamera("dragstart", (current) => current.onDragStart);
    const onDrag = emitCamera("drag", (current) => current.onDrag);
    const onDragEnd = emitCamera("dragend", (current) => current.onDragEnd);
    const onWheel = (event: MapWheelEvent) => {
      propsRef.current.onWheel?.(event);
    };
    const onClick = (event: MapMouseEvent) => {
      propsRef.current.onClick?.(event);
    };
    const onContextMenu = (event: MapMouseEvent) => {
      propsRef.current.onContextMenu?.(event);
    };

    map.on("load", onLoad);
    // A style swap wipes the projection, so re-apply it whenever the style settles.
    map.on("styledata", applyProjection);
    map.on("movestart", onMoveStart);
    map.on("move", onMove);
    map.on("moveend", onMoveEnd);
    map.on("zoomstart", onZoomStart);
    map.on("zoom", onZoom);
    map.on("zoomend", onZoomEnd);
    map.on("dragstart", onDragStart);
    map.on("drag", onDrag);
    map.on("dragend", onDragEnd);
    map.on("wheel", onWheel);
    map.on("click", onClick);
    map.on("contextmenu", onContextMenu);

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (resizeTimer) {
              clearTimeout(resizeTimer);
            }
            resizeTimer = setTimeout(() => {
              resizeTimer = null;
              const width = container.clientWidth;
              const height = container.clientHeight;
              // Resizing fires `movestart`/`moveend`, so only resize when the
              // container really did change size.
              if (width === lastWidth && height === lastHeight) {
                return;
              }
              lastWidth = width;
              lastHeight = height;
              map.resize();
              map.redraw();
            }, RESIZE_DEBOUNCE_MS);
          });
    observer?.observe(container);

    return () => {
      observer?.disconnect();
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      mapRef.current = null;
      setReadyMap(null);
      map.remove();
    };
  }, []);

  React.useImperativeHandle<MapRef | null, MapRef | null>(ref, () => readyMap ?? mapRef.current, [
    readyMap,
  ]);

  const { mapStyle, cursor } = props;

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyMap || mapStyle === undefined || mapStyle === appliedStyleRef.current) {
      return;
    }
    appliedStyleRef.current = mapStyle;
    map.setStyle(mapStyle);
  }, [mapStyle, readyMap]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyMap) {
      return;
    }
    map.getCanvas().style.cursor = cursor ?? "";
  }, [cursor, readyMap]);

  const contextValue = React.useMemo<MapContextValue | null>(
    () => (readyMap ? { map: readyMap } : null),
    [readyMap],
  );

  const containerStyle = React.useMemo<React.CSSProperties>(
    () => ({ position: "relative", width: "100%", height: "100%", ...props.style }),
    [props.style],
  );

  return (
    <div
      {...(props.id !== undefined ? { id: props.id } : {})}
      {...(props.className !== undefined ? { className: props.className } : {})}
      ref={containerRef}
      style={containerStyle}
    >
      {contextValue ? (
        <MapContext.Provider value={contextValue}>
          <div data-map-children="" style={{ height: "100%" }}>
            {props.children}
          </div>
        </MapContext.Provider>
      ) : null}
    </div>
  );
};

/** Drop-in replacement for `react-map-gl/maplibre`'s default `<Map>` export. */
export const MapView = React.forwardRef(MapViewImpl);
