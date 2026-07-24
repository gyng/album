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
import { isStyleUsable, useLatestRef } from "./internal";
import { installVendoredWorker } from "./worker";
import {
  type MapRef,
  toViewStateChangeEvent,
  type ViewState,
  type ViewStateChangeEvent,
} from "./types";

type CameraHandler = ((event: ViewStateChangeEvent) => void) | undefined;

/**
 * How far the map has got, published on the container as `data-map-status` as
 * well as through `onError`, so a consumer can react without wiring a callback.
 *
 * - `initialising` — no map object yet (server render, or the first effect).
 * - `ready` — the map object exists and its children are mounted. The basemap
 *   may still be loading, or may never load at all.
 * - `loaded` — MapLibre fired `load`: the style and the first viewport's tiles
 *   are in. The only value that proves the map is genuinely alive.
 * - `unavailable` — terminal. The map object could not be built, so nothing
 *   will ever render and a caller showing a spinner should stop.
 */
export type MapViewStatus = "initialising" | "ready" | "loaded" | "unavailable";

export type MapErrorEvent = {
  /**
   * `worker` — the tile worker could not be pointed at its vendored asset. The
   * map is still built; MapLibre falls back to resolving the worker out of its
   * own bundle, which works everywhere except the production Turbopack build.
   * `construct` — the map could not be built at all: no WebGL context, or an
   * engine API that has moved. Terminal, and `status` becomes `unavailable`.
   * `runtime` — MapLibre reported an error against a live map: a style that
   * 404s, a blocked API key, a tile that will not load. The map object exists,
   * so markers, popups and controls carry on working over whatever did load.
   */
  type: "worker" | "construct" | "runtime";
  error: Error;
};

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

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
  /**
   * Anything that went wrong with the map itself. Most of these are survivable
   * — see `MapErrorEvent` — so this is a notification, not a render path.
   */
  onError?: (event: MapErrorEvent) => void;
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
    // MapLibre installs its own ResizeObserver unconditionally — `trackResize`
    // is only checked inside the callback — so a second observer here would
    // mean two observers and two `resize()` calls for every size change. Its
    // own is also leading-edge throttled, which reacts sooner than a debounce.
    trackResize: true,
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
  // Listeners are registered once and read the latest props through this ref,
  // so a re-render never has to tear listeners down and add them back.
  const propsRef = useLatestRef(props);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapRef | null>(null);
  // Seeded with the style the map is constructed from, so the first pass of the
  // style effect does not reload an identical style.
  const appliedStyleRef = React.useRef(props.mapStyle);

  const [attachedMap, setAttachedMap] = React.useState<MapRef | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState(false);

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

    const report = (type: MapErrorEvent["type"], error: unknown) => {
      const failure = toError(error);
      console.error(failure);
      propsRef.current.onError?.({ type, error: failure });
    };

    try {
      installVendoredWorker();
    } catch (error) {
      // Reported on its own rather than folded in with the construction
      // failure below: a renamed `setWorkerUrl` is a broken build, not a
      // machine without a GPU, and the two want completely different fixes.
      report("worker", error);
    }

    // Constructing the map is fallible: MapLibre throws "Failed to initialize
    // WebGL" whenever the browser cannot hand it a GL context — a machine with
    // no GL driver, a headless browser, a blocked or exhausted context, or a
    // user who has turned WebGL off. That is a degraded map, not a broken
    // application, so the failure is contained here: letting it escape a
    // `useEffect` would surface it to the nearest error boundary and take the
    // whole page down with it. The `try` covers the construction and nothing
    // else, so only a real construction failure can be read as one.
    let map: MapRef;
    try {
      map = new gl.Map(buildMapOptions(container, propsRef.current));
    } catch (error) {
      report("construct", error);
      // Terminal, and said so: a caller waiting on `onLoad` would otherwise
      // wait for ever with nothing to distinguish that from a slow network.
      setUnavailable(true);

      return;
    }
    mapRef.current = map;
    // Children mount against the map object, not the `load` event. `load` in
    // MapLibre 6 waits for the style *and* the first viewport's tiles, so a
    // style that 404s, a blocked API key, an offline reader or a broken tile
    // worker would otherwise take every marker, popup, control and overlay down
    // with the basemap — silently, with nothing for an error boundary to catch.
    // A failed basemap should degrade to pins over blank tiles, not a blank div.
    setAttachedMap(map);

    const emitCamera =
      (type: ViewStateChangeEvent["type"], pick: (props: MapViewProps) => CameraHandler) =>
      (event: MapLibreEvent<MouseEvent | TouchEvent | WheelEvent | undefined>) => {
        pick(propsRef.current)?.(toViewStateChangeEvent(type, map, event.originalEvent));
      };

    const onLoad = (event: MapLibreEvent) => {
      // Children no longer wait on this, but callers still need to be able to
      // tell a live basemap from a dead one — see `MapViewStatus`.
      setLoaded(true);
      propsRef.current.onLoad?.(event);
    };
    const onError = (event: { error?: Error }) => {
      report("runtime", event.error ?? new Error("The map reported an error."));
    };
    const applyProjection = () => {
      const projection = propsRef.current.projection;
      // `setProjection` runs `_checkLoaded` and throws while the style is still
      // settling, and `getProjection` reads through a style that may not be
      // there at all — the same guard every other style mutation here uses.
      if (projection === undefined || !isStyleUsable(map)) {
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
    // Surfaced rather than swallowed: MapLibre reports a missing style, a
    // rejected key and an unreachable tile here and nowhere else.
    map.on("error", onError);
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

    return () => {
      mapRef.current = null;
      setAttachedMap(null);
      setLoaded(false);
      map.remove();
    };
  }, [propsRef]);

  React.useImperativeHandle<MapRef | null, MapRef | null>(
    ref,
    () => attachedMap ?? mapRef.current,
    [attachedMap],
  );

  const { mapStyle, cursor } = props;

  React.useEffect(() => {
    const map = attachedMap;
    if (!map || mapStyle === undefined || mapStyle === appliedStyleRef.current) {
      return;
    }
    appliedStyleRef.current = mapStyle;
    map.setStyle(mapStyle);
  }, [mapStyle, attachedMap]);

  React.useEffect(() => {
    if (!attachedMap) {
      return;
    }
    attachedMap.getCanvas().style.cursor = cursor ?? "";
  }, [cursor, attachedMap]);

  const contextValue = React.useMemo<MapContextValue | null>(
    () => (attachedMap ? { map: attachedMap } : null),
    [attachedMap],
  );

  const containerStyle = React.useMemo<React.CSSProperties>(
    () => ({ position: "relative", width: "100%", height: "100%", ...props.style }),
    [props.style],
  );

  const status: MapViewStatus = unavailable
    ? "unavailable"
    : loaded
      ? "loaded"
      : contextValue
        ? "ready"
        : "initialising";

  return (
    <div
      {...(props.id !== undefined ? { id: props.id } : {})}
      {...(props.className !== undefined ? { className: props.className } : {})}
      ref={containerRef}
      style={containerStyle}
      data-map-status={status}
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
