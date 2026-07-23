import React from "react";
import type { MapWorldEntry, TimeRange } from "../util/pageDataTypes";
import { mixHsl, recencyColor } from "../util/mapColor";
import { MapRecencyLegend } from "./MapRecencyLegend";
import MapLibreMap, {
  ScaleControl,
  NavigationControl,
  GeolocateControl,
  FullscreenControl,
  Layer,
  Source,
  type ViewStateChangeEvent,
} from "./map/adapters/maplibre";
import { ThemeToggle } from "./ThemeToggle";
import {
  buildContextRoutePoints,
  buildMapRoute,
  RouteGeoJson,
  RouteMode,
  RoutePoint,
  toRouteGeoJson,
} from "./mapRoute";
import {
  filterPhotosByBounds,
  getLegendYears,
  getPhotoDateStats,
  isPhotoInTimeRange,
  MapBounds,
  stylePhotosByRecency,
} from "./mapWorldViewModel";
import {
  MapAutoFit,
  MapBoundsTracker,
  MapFitOnRequest,
  MapMiddleDragOrbit,
} from "./MapWorldMapChildren";
import { MapRouteOverlay } from "./MapRouteOverlay";
import { MapPhotoPopup } from "./MapPhotoPopup";
import { MapPhotoMarkers } from "./MapPhotoMarkers";
import { MapContextMenu, type MapContextPoint } from "./MapContextMenu";
import { buildMapDirectorSequence } from "./mapDirector";
import { MapDirector } from "./MapDirector";
import { MapLibreStyles } from "./MapLibreStyles";
import styles from "./MapWorld.module.css";

export type MapWorldProps = {
  photos: MapWorldEntry[];
  className: string;
  style?: React.CSSProperties;
  syncRoute?: boolean;
  fitToPhotos?: boolean;
  /** Increment to frame the current photos on demand (the "Fit to results"
   *  control), independent of the auto-fit that stays off during a search. */
  fitRequestId?: number;
  showThemeBootstrap?: boolean;
  showRoute?: boolean;
  routeMode?: RouteMode;
  routeDisplayMode?: "always" | "active-only";
  /** Live time range for opacity-based filtering during drag. */
  timeRange?: TimeRange | null;
  /** Show the colour-recency legend (defaults to true). */
  showLegend?: boolean;
  /**
   * Name each marker in place with its album, date and thumbnail. Meant for a
   * narrowed-down result set: on the full map this would bury it under labels.
   */
  previewMarkers?: boolean;
  /**
   * Whether the cinematic tour is playing. Controlled by the caller so the trigger can
   * live in its own UI: the map still stops the tour on any pan, wheel or orbit,
   * and reports that back through `onDirectorEnabledChange` so an external
   * control stays in sync.
   */
  directorEnabled?: boolean;
  onDirectorEnabledChange?: (enabled: boolean) => void;
  /** How many photos the tour would visit, so a caller can gate its trigger. */
  onDirectorSequenceLengthChange?: (length: number) => void;
};

// The single-album journey line is drawn in one solid colour: the recency
// colour of whichever photo the route currently belongs to (mid-ramp by
// default). Kept as a 3-stop shape for the callers that index into it.
const getRouteColorStops = (relative: number) => {
  const color = recencyColor(relative);
  return [
    { offset: "0%", color },
    { offset: "55%", color },
    { offset: "100%", color },
  ];
};

const getBackgroundJourneyGradientColors = (fromColor: string, toColor: string) => ({
  start: fromColor,
  quarter: mixHsl(fromColor, toColor, 0.25),
  middle: mixHsl(fromColor, toColor, 0.5),
  end: toColor,
});

const ROUTER_SYNC_DEBOUNCE_MS = 200;
const ROUTER_SYNC_PAUSE_MS = 700;
const MARKER_IMAGE_ZOOM_THRESHOLD = 8.5;

export const MMap: React.FC<MapWorldProps> = ({
  photos,
  className,
  style,
  syncRoute = true,
  fitToPhotos = false,
  fitRequestId = 0,
  showThemeBootstrap = true,
  showRoute = false,
  routeMode = "full",
  routeDisplayMode = "active-only",
  timeRange,
  showLegend = true,
  previewMarkers = false,
  directorEnabled = false,
  onDirectorEnabledChange,
  onDirectorSequenceLengthChange,
}) => {
  const url = typeof window === "undefined" ? null : new URL(window.location.toString());
  const initialLon = syncRoute ? (url?.searchParams.get("lon") ?? null) : null;
  const initialLat = syncRoute ? (url?.searchParams.get("lat") ?? null) : null;
  const initialZoom = syncRoute ? (url?.searchParams.get("zoom") ?? null) : null;

  const initialShowMarkerImages = Boolean(
    initialZoom && Number.parseFloat(initialZoom) > MARKER_IMAGE_ZOOM_THRESHOLD,
  );
  const [showMarkerImages, setShowMarkerImages] = React.useState(initialShowMarkerImages);
  const showMarkerImagesRef = React.useRef(initialShowMarkerImages);
  const [isInteracting, setIsInteracting] = React.useState(false);

  const [bounds, setBounds] = React.useState<MapBounds | null>(null);
  const timeFilteredPhotos = React.useMemo(
    () => (timeRange ? photos.filter((photo) => isPhotoInTimeRange(photo, timeRange)) : photos),
    [photos, timeRange],
  );
  const dateStats = React.useMemo(() => getPhotoDateStats(photos), [photos]);
  const photosWithStyles = React.useMemo(
    () => stylePhotosByRecency(timeFilteredPhotos, dateStats),
    [dateStats, timeFilteredPhotos],
  );
  const visiblePhotos = React.useMemo(
    () => filterPhotosByBounds(photosWithStyles, bounds),
    [bounds, photosWithStyles],
  );

  const [clickInfo, setClickInfo] = React.useState<MapWorldEntry | null>(null);
  const [hoverInfo, setHoverInfo] = React.useState<MapWorldEntry | null>(null);
  const [contextPoint, setContextPoint] = React.useState<MapContextPoint | null>(null);
  const stopDirector = React.useCallback(() => {
    onDirectorEnabledChange?.(false);
  }, [onDirectorEnabledChange]);
  const lastSyncedRouteRef = React.useRef<string>("");
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseUntilRef = React.useRef<number>(0);
  const popupInfo = clickInfo ?? hoverInfo;
  // Without clustering, many photos can share the same pixel and only the
  // topmost marker intercepts a tap. As a minimal mitigation, repeated clicks
  // on a stacked location cycle through every co-located photo so occluded
  // ones are still reachable. Uses the functional updater so it reads the
  // current selection without capturing it.
  const selectMarker = (photo: MapWorldEntry) => {
    stopDirector();
    setClickInfo((current) => {
      const coLocated = visiblePhotos.filter(
        (candidate) => candidate.decLat === photo.decLat && candidate.decLng === photo.decLng,
      );

      if (coLocated.length <= 1 || !current) {
        return photo;
      }

      const currentIndex = coLocated.findIndex((candidate) => candidate.href === current.href);

      if (currentIndex === -1) {
        return photo;
      }

      return coLocated[(currentIndex + 1) % coLocated.length]!;
    });
  };
  const routeDataByAlbum = React.useMemo(() => {
    const albums = new globalThis.Map<string, MapWorldEntry[]>();
    timeFilteredPhotos.forEach((photo) => {
      const existing = albums.get(photo.album);
      if (existing) {
        existing.push(photo);
        return;
      }

      albums.set(photo.album, [photo]);
    });

    return new globalThis.Map(
      Array.from(albums.entries()).map(([album, albumPhotos]) => [
        album,
        buildMapRoute(albumPhotos),
      ]),
    );
  }, [timeFilteredPhotos]);
  const directorSequence = React.useMemo(
    () => buildMapDirectorSequence(timeFilteredPhotos),
    [timeFilteredPhotos],
  );
  React.useEffect(() => {
    onDirectorSequenceLengthChange?.(directorSequence.length);
  }, [directorSequence.length, onDirectorSequenceLengthChange]);
  React.useEffect(() => {
    // Filtering down to a single photo leaves nothing to tour.
    if (directorSequence.length < 2) {
      onDirectorEnabledChange?.(false);
    }
  }, [directorSequence.length, onDirectorEnabledChange]);
  const visitDirectorPhoto = React.useCallback((photo: MapWorldEntry) => {
    setClickInfo(photo);
    setHoverInfo(null);
    setContextPoint(null);
  }, []);
  const activeRouteTarget = clickInfo?.href ?? hoverInfo?.href ?? null;
  const activeRoutePhoto = React.useMemo(
    () => photosWithStyles.find((photo) => photo.href === activeRouteTarget) ?? null,
    [activeRouteTarget, photosWithStyles],
  );
  const activeContextRoutePoints = React.useMemo(() => {
    if (!activeRouteTarget) {
      return null;
    }

    return buildContextRoutePoints(timeFilteredPhotos, activeRouteTarget, routeMode);
  }, [activeRouteTarget, routeMode, timeFilteredPhotos]);
  const activeContextRouteGeoJson = React.useMemo(
    () => toRouteGeoJson(activeContextRoutePoints ?? []),
    [activeContextRoutePoints],
  );
  const markerColorByHref = React.useMemo(
    () =>
      new globalThis.Map(photosWithStyles.map((photo) => [photo.href, photo.markerColor] as const)),
    [photosWithStyles],
  );
  const fullRoutePoints = React.useMemo(() => {
    if (!showRoute || routeDisplayMode !== "always") {
      return null;
    }

    if (routeDataByAlbum.size === 1) {
      const route = Array.from(routeDataByAlbum.values())[0];
      return routeMode === "simplified" ? route!.simplifiedPoints : route!.fullPoints;
    }

    return null;
  }, [routeDataByAlbum, routeDisplayMode, routeMode, showRoute]);

  React.useEffect(() => {
    if (clickInfo && !timeFilteredPhotos.some((photo) => photo.href === clickInfo.href)) {
      setClickInfo(null);
    }
    if (hoverInfo && !timeFilteredPhotos.some((photo) => photo.href === hoverInfo.href)) {
      setHoverInfo(null);
    }
  }, [clickInfo, hoverInfo, timeFilteredPhotos]);
  const alwaysVisibleRouteGeoJson = React.useMemo(() => {
    if (!showRoute || routeDisplayMode !== "always") {
      return null;
    }

    if (fullRoutePoints) {
      return toRouteGeoJson(fullRoutePoints);
    }

    const features = Array.from(routeDataByAlbum.entries()).flatMap(([album, route]) => {
      const points = routeMode === "simplified" ? route.simplifiedPoints : route.fullPoints;
      const routeGeoJson = toRouteGeoJson(points);
      const startPoint = points[0];
      const endPoint = points.at(-1);
      if (!routeGeoJson || !startPoint || !endPoint) {
        return [];
      }
      const gradientColors = getBackgroundJourneyGradientColors(
        markerColorByHref.get(startPoint.memberHrefs.at(-1)!)!,
        markerColorByHref.get(endPoint.memberHrefs.at(-1)!)!,
      );

      return routeGeoJson.features.map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          album,
          routeColorStart: gradientColors.start,
          routeColorQuarter: gradientColors.quarter,
          routeColorMiddle: gradientColors.middle,
          routeColorEnd: gradientColors.end,
        },
      }));
    });

    if (features.length === 0) {
      return null;
    }

    return {
      type: "FeatureCollection",
      features,
    } satisfies RouteGeoJson;
  }, [
    fullRoutePoints,
    markerColorByHref,
    routeDataByAlbum,
    routeDisplayMode,
    routeMode,
    showRoute,
  ]);
  const routeGeoJson = alwaysVisibleRouteGeoJson ?? activeContextRouteGeoJson;
  const overlayRoutePoints = activeContextRoutePoints ?? fullRoutePoints;
  const ghostRoutePoints =
    activeContextRoutePoints &&
    fullRoutePoints &&
    activeContextRoutePoints.length !== fullRoutePoints.length
      ? fullRoutePoints
      : null;
  const activeRouteHrefSet = React.useMemo(
    () => new Set(overlayRoutePoints?.flatMap((point) => point.memberHrefs) ?? []),
    [overlayRoutePoints],
  );
  const shouldEmphasizeRouteMarkers = clickInfo !== null;
  const getRoutePointColor = React.useCallback(
    (point: RoutePoint, _index: number) => {
      const memberHref = point.memberHrefs.at(-1)!;
      return markerColorByHref.get(memberHref)!;
    },
    [markerColorByHref],
  );
  const routeColorStops = React.useMemo(
    () => getRouteColorStops(activeRoutePhoto?.relative ?? 0.6),
    [activeRoutePhoto?.relative],
  );

  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const routeLineWidth = routeMode === "simplified" ? 4 : 3;

  const legendYears = React.useMemo(() => getLegendYears(dateStats), [dateStats]);
  const shouldShowLegend = showLegend && dateStats.range > 0 && timeFilteredPhotos.length > 1;

  const pauseRouterSync = React.useCallback(() => {
    if (!syncRoute) {
      return;
    }

    pauseUntilRef.current = Date.now() + ROUTER_SYNC_PAUSE_MS;
  }, [syncRoute]);

  const updateParams = (e: ViewStateChangeEvent) => {
    if (!syncRoute) {
      return;
    }

    const cameraParams = {
      lat: e.viewState.latitude.toFixed(3).toString(),
      lon: e.viewState.longitude.toFixed(3).toString(),
      zoom: e.viewState.zoom.toFixed(2).toString(),
    };

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      if (Date.now() < pauseUntilRef.current) {
        return;
      }

      // Merge into the live URL when the timer executes. Other controls can
      // update their query params while camera sync is pending; capturing the
      // whole URL above would restore those stale values.
      const url = new URL(window.location.toString());
      const searchParams = new URLSearchParams(url.search);
      // Always write every camera param — skipping at sentinel values (lat 0 /
      // lon 0 / zoom 1) would leave a stale earlier value in the URL.
      searchParams.set("lat", cameraParams.lat);
      searchParams.set("lon", cameraParams.lon);
      searchParams.set("zoom", cameraParams.zoom);
      url.search = searchParams.toString();
      const nextRoute = `${url.pathname}${url.search}${url.hash}`;
      if (nextRoute === lastSyncedRouteRef.current) {
        return;
      }

      lastSyncedRouteRef.current = nextRoute;
      window.history.replaceState(window.history.state, "", nextRoute);
    }, ROUTER_SYNC_DEBOUNCE_MS);
  };

  const updateMarkerImageVisibility = React.useCallback((nextZoom: number) => {
    const nextShowMarkerImages = nextZoom > MARKER_IMAGE_ZOOM_THRESHOLD;
    if (nextShowMarkerImages === showMarkerImagesRef.current) {
      return;
    }

    showMarkerImagesRef.current = nextShowMarkerImages;
    setShowMarkerImages(nextShowMarkerImages);
  }, []);

  return (
    <div className={className}>
      <MapLibreStyles />
      {showThemeBootstrap ? (
        <div className={styles.themeBootstrap}>
          <ThemeToggle />
        </div>
      ) : null}
      <div className={styles.mapViewport} style={style}>
        <MapLibreMap
          // two options for map style
          // mapStyle="https://tiles.openfreemap.org/styles/liberty"
          // mapStyle="https://vector.openstreetmap.org/shortbread_v1/tilejson.json"
          // Public API key — domain-restricted on MapTiler side, not a secret.
          mapStyle="https://api.maptiler.com/maps/ffd8bd10-cd97-40a5-b1d6-d15f98fb3644/style.json?key=iilC4hPY1594noPX9OQ2"
          // Collapsed to an "i" the reader can expand, as Map.tsx already does.
          // The full credit line is wide enough to crowd the bottom of a phone
          // screen, and the attribution stays one tap away either way.
          attributionControl={{ compact: true }}
          onLoad={(event) => {
            // `compact` only makes the attribution collapsible: MapLibre still
            // renders it open and only minimises it once you touch the map
            // (_updateCompact adds `maplibregl-compact-show`,
            // _updateCompactMinimize removes it on interaction). Collapse it up
            // front instead. This does not fight the control: _updateCompact
            // only re-adds the class when `maplibregl-compact` is absent, and by
            // now it is set, so resizing will not reopen it.
            // It is a <details>, so `open` has to go too, not just the class.
            const attribution = event.target
              .getContainer()
              .querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
            attribution?.classList.remove("maplibregl-compact-show");
            attribution?.removeAttribute("open");
          }}
          initialViewState={{
            ...(initialLon ? { longitude: Number.parseFloat(initialLon) } : {}),
            ...(initialLat ? { latitude: Number.parseFloat(initialLat) } : {}),
            ...(initialZoom ? { zoom: Number.parseFloat(initialZoom) } : {}),
          }}
          onMoveStart={() => {
            setContextPoint(null);
            setIsInteracting(true);
          }}
          onClick={() => {
            setContextPoint(null);
          }}
          onContextMenu={(event) => {
            event.originalEvent.preventDefault();
            stopDirector();
            setContextPoint({
              latitude: event.lngLat.lat,
              longitude: event.lngLat.lng,
            });
          }}
          onDragStart={stopDirector}
          onWheel={stopDirector}
          onZoom={(e) => {
            updateMarkerImageVisibility(e.viewState.zoom);
          }}
          onZoomStart={() => {
            setIsInteracting(true);
          }}
          onZoomEnd={(event) => {
            setIsInteracting(false);
            updateParams(event);
          }}
          onMoveEnd={(event) => {
            setIsInteracting(false);
            updateParams(event);
          }}
        >
          <MapAutoFit enabled={fitToPhotos} photos={photos} />
          <MapFitOnRequest requestId={fitRequestId} photos={photos} />
          <MapBoundsTracker onBoundsChange={setBounds} />
          <MapMiddleDragOrbit onInteractionStart={stopDirector} />
          <MapDirector
            enabled={directorEnabled}
            sequence={directorSequence}
            onVisit={visitDirectorPhoto}
          />
          {routeGeoJson ? (
            <Source id="journey-line-source" type="geojson" data={routeGeoJson} lineMetrics>
              <Layer
                id="journey-line-glow-layer"
                type="line"
                paint={{
                  "line-color":
                    routeDataByAlbum.size > 1
                      ? ["coalesce", ["get", "routeColorMiddle"], "#b7eef5"]
                      : "#dbfbff",
                  "line-opacity": routeDataByAlbum.size > 1 ? 0.34 : 0.35,
                  "line-width":
                    routeDataByAlbum.size > 1
                      ? ["interpolate", ["linear"], ["line-progress"], 0, 2.4, 0.32, 6.2, 1, 10.2]
                      : routeLineWidth + 4,
                }}
              />
              <Layer
                id="journey-line-layer"
                type="line"
                paint={{
                  // Multi-album ("show all journeys") draws each trip's line in
                  // its own solid recency colour (`line-gradient` can't be
                  // data-driven per feature, so a per-feature solid colour is
                  // used instead of a shared gradient). Single-album keeps the
                  // one recency colour of the active route.
                  "line-color":
                    routeDataByAlbum.size > 1
                      ? ["coalesce", ["get", "routeColorMiddle"], "#12bcd4"]
                      : routeColorStops[1]!.color,
                  "line-opacity": alwaysVisibleRouteGeoJson
                    ? routeDataByAlbum.size > 1
                      ? 1
                      : routeMode === "simplified"
                        ? 0.55
                        : 0.78
                    : 0.24,
                  "line-width":
                    routeDataByAlbum.size > 1
                      ? ["interpolate", ["linear"], ["line-progress"], 0, 1.1, 0.32, 4.8, 1, 8]
                      : routeLineWidth,
                  ...(routeDataByAlbum.size > 1 ? {} : { "line-dasharray": [2, 2] }),
                }}
              />
            </Source>
          ) : null}
          {!isInteracting && routeGeoJson ? (
            <MapRouteOverlay
              routePoints={overlayRoutePoints}
              routeMode={routeMode}
              getPointColor={getRoutePointColor}
              showSpeedLabels={clickInfo !== null || hoverInfo !== null}
              ghostRoutePoints={ghostRoutePoints}
            />
          ) : null}

          <MapPhotoPopup
            photo={popupInfo}
            selected={clickInfo !== null}
            onClose={() => {
              setClickInfo(null);
            }}
            onInteractionStart={pauseRouterSync}
          />

          <MapContextMenu
            point={contextPoint}
            onClose={() => {
              setContextPoint(null);
            }}
            onInteractionStart={pauseRouterSync}
          />

          <MapPhotoMarkers
            photos={visiblePhotos}
            showMarkerImages={showMarkerImages}
            previewMarkers={previewMarkers}
            emphasiseRoute={shouldEmphasizeRouteMarkers}
            activeRouteHrefSet={activeRouteHrefSet}
            onSelect={selectMarker}
            onHover={setHoverInfo}
          />

          <NavigationControl />
          <GeolocateControl />
          <ScaleControl />
          {shouldShowLegend ? (
            <MapRecencyLegend olderLabel={legendYears.older} newerLabel={legendYears.newer} />
          ) : null}
          <FullscreenControl />
        </MapLibreMap>
      </div>
    </div>
  );
};

export default MMap;
