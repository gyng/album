import React from "react";
import styles from "./MapWorld.module.css";
import pinStyles from "./mapPin.module.css";
import { OptimisedPhoto } from "../services/types";
import { mixHsl, recencyColor } from "../util/mapColor";
import { MapRecencyLegend } from "./MapRecencyLegend";
import MapLibreMap, {
  Marker,
  ScaleControl,
  NavigationControl,
  GeolocateControl,
  FullscreenControl,
  Layer,
  Source,
  ViewStateChangeEvent,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
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
  formatMapPhotoDate,
  getLegendYears,
  getPhotoDateStats,
  isPhotoInTimeRange,
  MapBounds,
  stylePhotosByRecency,
} from "./mapWorldViewModel";
import { LazyMapMarkerImage, MapAutoFit, MapBoundsTracker } from "./MapWorldMapChildren";
import { MapRouteOverlay } from "./MapRouteOverlay";
import { MapPhotoPopup } from "./MapPhotoPopup";

export type MapWorldEntry = {
  album: string;
  src: OptimisedPhoto;
  decLat: number | null;
  decLng: number | null;
  date: string | null;
  href: string;
  placeholderColor?: string;
  placeholderWidth?: number;
  placeholderHeight?: number;
};

export type TimeRange = { fromMs: number; toMs: number };

export type MapWorldProps = {
  photos: MapWorldEntry[];
  className: string;
  style?: React.CSSProperties;
  syncRoute?: boolean;
  fitToPhotos?: boolean;
  showThemeBootstrap?: boolean;
  showRoute?: boolean;
  routeMode?: RouteMode;
  routeDisplayMode?: "always" | "active-only";
  /** Live time range for opacity-based filtering during drag. */
  timeRange?: TimeRange | null;
  /** Show the colour-recency legend (defaults to true). */
  showLegend?: boolean;
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

export const MMap: React.FC<MapWorldProps> = ({
  photos,
  className,
  style,
  syncRoute = true,
  fitToPhotos = false,
  showThemeBootstrap = true,
  showRoute = false,
  routeMode = "full",
  routeDisplayMode = "active-only",
  timeRange,
  showLegend = true,
}) => {
  const url = typeof window === "undefined" ? null : new URL(window.location.toString());
  const initialLon = syncRoute ? (url?.searchParams.get("lon") ?? null) : null;
  const initialLat = syncRoute ? (url?.searchParams.get("lat") ?? null) : null;
  const initialZoom = syncRoute ? (url?.searchParams.get("zoom") ?? null) : null;

  const [zoom, setZoom] = React.useState<number | null>(
    initialZoom ? Number.parseFloat(initialZoom) : null,
  );
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

      return coLocated[(currentIndex + 1) % coLocated.length] ?? photo;
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
      return routeMode === "simplified"
        ? (route?.simplifiedPoints ?? null)
        : (route?.fullPoints ?? null);
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
      const gradientColors =
        startPoint && endPoint
          ? getBackgroundJourneyGradientColors(
              markerColorByHref.get(startPoint.memberHrefs.at(-1) ?? startPoint.href) ??
                markerColorByHref.get(startPoint.href) ??
                "#12bcd4",
              markerColorByHref.get(endPoint.memberHrefs.at(-1) ?? endPoint.href) ??
                markerColorByHref.get(endPoint.href) ??
                "#12bcd4",
            )
          : null;

      return (
        routeGeoJson?.features.map((feature) => ({
          ...feature,
          properties: {
            ...feature.properties,
            album,
            routeColorStart: gradientColors?.start ?? "#0f4b6e",
            routeColorQuarter: gradientColors?.quarter ?? "#145b83",
            routeColorMiddle: gradientColors?.middle ?? "#12bcd4",
            routeColorEnd: gradientColors?.end ?? "#b9fbff",
          },
        })) ?? []
      );
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
    () =>
      new Set(
        overlayRoutePoints?.flatMap((point) =>
          point.memberHrefs.length > 0 ? point.memberHrefs : [point.href],
        ) ?? [],
      ),
    [overlayRoutePoints],
  );
  const shouldEmphasizeRouteMarkers = clickInfo !== null;
  const getRoutePointColor = React.useCallback(
    (point: RoutePoint, _index: number) => {
      const memberHref = point.memberHrefs.at(-1) ?? point.href;
      return (
        markerColorByHref.get(memberHref) ??
        markerColorByHref.get(point.href) ??
        activeRoutePhoto?.markerColor ??
        "#12bcd4"
      );
    },
    [activeRoutePhoto?.markerColor, markerColorByHref],
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

    const url = new URL(window.location.toString());
    const searchParams = new URLSearchParams(window.location.search);

    // Always write every camera param — skipping at sentinel values (lat 0 /
    // lon 0 / zoom 1) would leave a stale earlier value in the URL.
    searchParams.set("lat", e.viewState.latitude.toFixed(3).toString());
    searchParams.set("lon", e.viewState.longitude.toFixed(3).toString());
    searchParams.set("zoom", e.viewState.zoom.toFixed(2).toString());

    url.search = searchParams.toString();
    const nextRoute = `${url.pathname}${url.search}${url.hash}`;
    if (nextRoute === lastSyncedRouteRef.current) {
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      if (Date.now() < pauseUntilRef.current) {
        return;
      }

      lastSyncedRouteRef.current = nextRoute;
      window.history.replaceState(window.history.state, "", nextRoute);
    }, ROUTER_SYNC_DEBOUNCE_MS);
  };

  return (
    <div className={className}>
      {showThemeBootstrap ? (
        <div style={{ position: "fixed", pointerEvents: "none", opacity: "0" }}>
          <ThemeToggle />
        </div>
      ) : null}
      <MapLibreMap
        style={{ width: "100%", height: "100%", ...style }}
        // two options for map style
        // mapStyle="https://tiles.openfreemap.org/styles/liberty"
        // mapStyle="https://vector.openstreetmap.org/shortbread_v1/tilejson.json"
        // Public API key — domain-restricted on MapTiler side, not a secret.
        mapStyle="https://api.maptiler.com/maps/ffd8bd10-cd97-40a5-b1d6-d15f98fb3644/style.json?key=iilC4hPY1594noPX9OQ2"
        initialViewState={{
          longitude: initialLon ? Number.parseFloat(initialLon) : undefined,
          latitude: initialLat ? Number.parseFloat(initialLat) : undefined,
          zoom: initialZoom ? Number.parseFloat(initialZoom) : undefined,
        }}
        onMoveStart={() => {
          setIsInteracting(true);
        }}
        onZoom={(e) => {
          setZoom(e.viewState.zoom);
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
        <MapBoundsTracker onBoundsChange={setBounds} />
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
                    : (routeColorStops[1]?.color ?? "#12bcd4"),
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

        {visiblePhotos.map((photo) => {
          return photo.decLat != null && photo.decLng != null ? (
            <React.Fragment key={photo.href ?? photo?.src?.src ?? ""}>
              <Marker
                longitude={photo.decLng}
                latitude={photo.decLat}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  selectMarker(photo);
                }}
                color={photo.markerColor}
              >
                <div>
                  {zoom && zoom > 8.5 ? <LazyMapMarkerImage photo={photo} /> : null}
                  <span
                    style={{ color: photo.markerColor }}
                    className={[
                      pinStyles.pin,
                      shouldEmphasizeRouteMarkers && activeRouteHrefSet.size > 0
                        ? activeRouteHrefSet.has(photo.href)
                          ? styles.pinActive
                          : styles.pinMuted
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    role="button"
                    tabIndex={0}
                    aria-label={`Photo from ${photo.album}${formatMapPhotoDate(photo.date) ? ` on ${formatMapPhotoDate(photo.date)}` : ""}`}
                    onMouseOver={() => {
                      setHoverInfo(photo);
                    }}
                    onMouseLeave={() => {
                      setHoverInfo(null);
                    }}
                    onFocus={() => {
                      setHoverInfo(photo);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        selectMarker(photo);
                      }
                    }}
                  />
                </div>
              </Marker>
            </React.Fragment>
          ) : null;
        })}

        <NavigationControl />
        <GeolocateControl />
        <ScaleControl />
        {shouldShowLegend ? (
          <MapRecencyLegend olderLabel={legendYears.older} newerLabel={legendYears.newer} />
        ) : null}
        <FullscreenControl />
      </MapLibreMap>
    </div>
  );
};

export default MMap;
