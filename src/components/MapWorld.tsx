import React from "react";
import styles from "./MapWorld.module.css";
import { OptimisedPhoto } from "../services/types";
import Link from "next/link";
import { getRelativeTimeString } from "../util/time";
import MapLibreMap, {
  Marker,
  Popup,
  ScaleControl,
  NavigationControl,
  GeolocateControl,
  FullscreenControl,
  Layer,
  Source,
  ViewStateChangeEvent,
  useMap,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useIntersectionObserver } from "usehooks-ts";
import { ThemeToggle } from "./ThemeToggle";
import {
  buildContextRouteGeoJson,
  buildContextRoutePoints,
  buildMapRoute,
  distanceMetersBetween,
  RouteGeoJson,
  RouteMode,
  RoutePoint,
  toRouteGeoJson,
} from "./mapRoute";

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
};

const MapAutoFit = ({
  enabled,
  photos,
}: {
  enabled: boolean;
  photos: MapWorldEntry[];
}) => {
  const { current: map } = useMap();

  React.useEffect(() => {
    if (!enabled || !map) {
      return;
    }

    const coordinates = photos
      .filter((photo) => photo.decLat !== null && photo.decLng !== null)
      .map(
        (photo) =>
          [photo.decLng as number, photo.decLat as number] as [number, number],
      );

    if (coordinates.length === 0) {
      return;
    }

    if (coordinates.length === 1) {
      const [longitude, latitude] = coordinates[0];
      map.flyTo({ center: [longitude, latitude], zoom: 10.5, speed: 2.2 });
      return;
    }

    const longitudes = coordinates.map(([longitude]) => longitude);
    const latitudes = coordinates.map(([, latitude]) => latitude);

    map.fitBounds(
      [
        [Math.min(...longitudes), Math.min(...latitudes)],
        [Math.max(...longitudes), Math.max(...latitudes)],
      ],
      {
        padding: 36,
        duration: 0,
        maxZoom: 11,
      },
    );
  }, [enabled, map, photos]);

  return null;
};

const LazyImage = ({ photo }: { photo: MapWorldEntry }) => {
  const { entry, ref } = useIntersectionObserver({ rootMargin: "100px" });
  const isVisible = !!entry?.isIntersecting;

  return (
    <div ref={ref}>
      {isVisible && (
        <img
          src={photo.src.src}
          className={styles.photoMarkerImage}
          width={photo.placeholderWidth}
          height={photo.placeholderHeight}
          style={{
            backgroundColor: `${photo.placeholderColor}`,
          }}
          loading="lazy"
          alt=""
          aria-hidden="true"
        />
      )}
    </div>
  );
};

// Component to track map bounds for viewport culling
const MapBoundsTracker = ({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }) => void;
}) => {
  const { current: map } = useMap();

  React.useEffect(() => {
    if (!map) return;

    const updateBounds = () => {
      const bounds = map.getBounds();
      if (bounds) {
        onBoundsChange({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
      }
    };

    // Set initial bounds
    updateBounds();

    // Update bounds on move
    map.on("moveend", updateBounds);
    map.on("zoomend", updateBounds);

    return () => {
      map.off("moveend", updateBounds);
      map.off("zoomend", updateBounds);
    };
  }, [map, onBoundsChange]);

  return null;
};

type PhotoWithStyle = MapWorldEntry & {
  relative: number;
  markerColor: string;
  hueRotate: string;
};

const getRouteColorStops = (relative: number) => {
  const hue = relative * 220;
  const lightness = 56;

  return [
    {
      offset: "0%",
      color: `hsl(${Math.max(0, hue - 18).toFixed(1)} 38% ${lightness}%)`,
    },
    {
      offset: "55%",
      color: `hsl(${hue.toFixed(1)} 64% ${lightness}%)`,
    },
    {
      offset: "100%",
      color: `hsl(${Math.min(220, hue + 10).toFixed(1)} 92% ${lightness}%)`,
    },
  ];
};

const parseHslColor = (
  color: string,
): { hue: number; saturation: number; lightness: number } | null => {
  const match = color.match(
    /hsl\(\s*([+-]?\d*\.?\d+)(?:deg)?(?:\s+|,\s*)(\d*\.?\d+)%(?:\s+|,\s*)(\d*\.?\d+)%\s*\)/i,
  );

  if (!match) {
    return null;
  }

  const hue = Number.parseFloat(match[1] ?? "");
  const saturation = Number.parseFloat(match[2] ?? "");
  const lightness = Number.parseFloat(match[3] ?? "");

  if ([hue, saturation, lightness].some((value) => Number.isNaN(value))) {
    return null;
  }

  return { hue, saturation, lightness };
};

const withSaturation = (
  color: string,
  nextSaturation: number,
  nextLightness?: number,
): string => {
  const parsed = parseHslColor(color);
  if (!parsed) {
    return color;
  }

  return `hsl(${parsed.hue.toFixed(1)} ${Math.max(
    0,
    Math.min(100, nextSaturation),
  ).toFixed(1)}% ${(nextLightness ?? parsed.lightness).toFixed(1)}%)`;
};

const getDirectionalGradientStops = (fromColor: string, toColor: string) => {
  const olderColor = withSaturation(fromColor, 100, 20);
  const middleColor = withSaturation(toColor, 100, 50);
  const newerColor = withSaturation(toColor, 100, 78);

  return [
    { offset: "0%", color: olderColor },
    { offset: "38%", color: middleColor },
    { offset: "100%", color: newerColor },
  ];
};

const getDirectionalGradientColors = (fromColor: string, toColor: string) => {
  const stops = getDirectionalGradientStops(fromColor, toColor);

  return {
    start: stops[0]?.color ?? fromColor,
    middle: stops[1]?.color ?? toColor,
    end: stops[2]?.color ?? toColor,
  };
};

const getBackgroundJourneyGradientColors = (
  fromColor: string,
  toColor: string,
) => {
  return {
    start: withSaturation(fromColor, 100, 10),
    quarter: withSaturation(fromColor, 100, 24),
    middle: withSaturation(toColor, 100, 56),
    end: withSaturation(toColor, 100, 90),
  };
};

const getRouteSpeedSeconds = (
  fromDate: string | null,
  toDate: string | null,
): number => {
  const from = fromDate ? new Date(fromDate).valueOf() : NaN;
  const to = toDate ? new Date(toDate).valueOf() : NaN;

  if (Number.isNaN(from) || Number.isNaN(to)) {
    return 1.4;
  }

  const gapMinutes = Math.max(1, Math.abs(to - from) / (60 * 1000));
  const normalized = Math.min(1, gapMinutes / (12 * 60));

  return Number((0.9 + normalized * 1.6).toFixed(2));
};

const getApproxSpeedKmh = (
  fromPoint: RoutePoint,
  toPoint: RoutePoint,
): number | null => {
  const from = fromPoint.date ? new Date(fromPoint.date).valueOf() : NaN;
  const to = toPoint.date ? new Date(toPoint.date).valueOf() : NaN;

  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) {
    return null;
  }

  const hours = (to - from) / (60 * 60 * 1000);
  if (hours <= 0) {
    return null;
  }

  const distanceKm =
    distanceMetersBetween(
      {
        decLat: fromPoint.decLat as number,
        decLng: fromPoint.decLng as number,
      },
      { decLat: toPoint.decLat as number, decLng: toPoint.decLng as number },
    ) / 1000;

  if (distanceKm < 0.1) {
    return null;
  }

  const speed = distanceKm / hours;
  if (!Number.isFinite(speed) || speed < 1 || speed > 500) {
    return null;
  }

  return Math.round(speed);
};

const getDistanceKm = (fromPoint: RoutePoint, toPoint: RoutePoint): number => {
  return (
    distanceMetersBetween(
      {
        decLat: fromPoint.decLat as number,
        decLng: fromPoint.decLng as number,
      },
      { decLat: toPoint.decLat as number, decLng: toPoint.decLng as number },
    ) / 1000
  );
};

const formatDistanceKm = (distanceKm: number): string => {
  if (distanceKm >= 10) {
    return `${Math.round(distanceKm)}km`;
  }

  return `${distanceKm.toFixed(1)}km`;
};

const getReadableLabelAngle = (angle: number): number => {
  if (angle > 90) {
    return angle - 180;
  }

  if (angle < -90) {
    return angle + 180;
  }

  return angle;
};

const isTransferLeg = (
  distanceKm: number,
  durationSeconds: number,
): boolean => {
  const hours = durationSeconds / 3600;
  return distanceKm >= 12 || hours >= 2;
};

const useMapOverlayVersion = () => {
  const { current: map } = useMap();
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    if (!map) {
      return;
    }

    let frameId: number | null = null;
    const update = () => {
      if (process.env.NODE_ENV === "test") {
        setVersion((current) => current + 1);
        return;
      }

      if (frameId !== null) {
        return;
      }

      frameId = requestAnimationFrame(() => {
        frameId = null;
        setVersion((current) => current + 1);
      });
    };

    update();
    map.on("move", update);
    map.on("zoom", update);
    map.on("resize", update);

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      map.off("move", update);
      map.off("zoom", update);
      map.off("resize", update);
    };
  }, [map]);

  return { map, version };
};

const MapRouteOverlay = ({
  routePoints,
  routeMode,
  getPointColor,
  showSpeedLabels,
  ghostRoutePoints,
}: {
  routePoints: RoutePoint[] | null;
  routeMode: RouteMode;
  getPointColor: (point: RoutePoint, index: number) => string;
  showSpeedLabels: boolean;
  ghostRoutePoints: RoutePoint[] | null;
}) => {
  const { map, version } = useMapOverlayVersion();

  const projectedSegments = React.useMemo(() => {
    void version;

    if (!map || !routePoints || routePoints.length < 2) {
      return [];
    }

    return routePoints.slice(0, -1).flatMap((point, index) => {
      const nextPoint = routePoints[index + 1];
      if (!nextPoint) {
        return [];
      }
      const start = map.project([
        point.decLng as number,
        point.decLat as number,
      ]);
      const end = map.project([
        nextPoint.decLng as number,
        nextPoint.decLat as number,
      ]);
      if (
        typeof start?.x !== "number" ||
        typeof start?.y !== "number" ||
        typeof end?.x !== "number" ||
        typeof end?.y !== "number"
      ) {
        return [];
      }

      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      const normalX = length > 0 ? -dy / length : 0;
      const normalY = length > 0 ? dx / length : 0;
      return [
        {
          id: `${point.href}-${nextPoint.href}`,
          d: `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
          color: getPointColor(nextPoint, index + 1),
          durationSeconds: getRouteSpeedSeconds(point.date, nextPoint.date),
          approxSpeedKmh: getApproxSpeedKmh(point, nextPoint),
          distanceKm: getDistanceKm(point, nextPoint),
          midX: Number(((start.x + end.x) / 2 + normalX * 10).toFixed(2)),
          midY: Number(((start.y + end.y) / 2 + normalY * 10).toFixed(2)),
          startX: Number(start.x.toFixed(2)),
          startY: Number(start.y.toFixed(2)),
          endX: Number(end.x.toFixed(2)),
          endY: Number(end.y.toFixed(2)),
          angle: Number(
            getReadableLabelAngle(
              (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI,
            ).toFixed(2),
          ),
          lengthPx: length,
        },
      ];
    });
  }, [getPointColor, map, routePoints, version]);

  const routeGradient = React.useMemo(() => {
    if (
      !routePoints ||
      routePoints.length < 2 ||
      projectedSegments.length === 0
    ) {
      return null;
    }

    const startPoint = routePoints[0];
    const endPoint = routePoints.at(-1);
    const firstSegment = projectedSegments[0];
    const lastSegment = projectedSegments.at(-1);

    if (!startPoint || !endPoint || !firstSegment || !lastSegment) {
      return null;
    }

    return {
      id: "journey-line-route-gradient",
      x1: firstSegment.startX,
      y1: firstSegment.startY,
      x2: lastSegment.endX,
      y2: lastSegment.endY,
      stops: getDirectionalGradientStops(
        getPointColor(startPoint, 0),
        getPointColor(endPoint, routePoints.length - 1),
      ),
    };
  }, [getPointColor, projectedSegments, routePoints]);

  const projectedGhostPath = React.useMemo(() => {
    void version;

    if (!map || !ghostRoutePoints || ghostRoutePoints.length < 2) {
      return null;
    }

    const points = ghostRoutePoints
      .map((point) =>
        map.project([point.decLng as number, point.decLat as number]),
      )
      .filter(
        (point) => typeof point?.x === "number" && typeof point?.y === "number",
      );

    if (points.length < 2) {
      return null;
    }

    return points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
      )
      .join(" ");
  }, [ghostRoutePoints, map, version]);

  const preferredLabelSegmentIds = React.useMemo(() => {
    const candidates = projectedSegments
      .filter(
        (segment) =>
          segment.approxSpeedKmh !== null &&
          (segment.distanceKm >= 5 || segment.lengthPx >= 24),
      )
      .sort((left, right) => {
        const leftScore = left.lengthPx;
        const rightScore = right.lengthPx;
        return rightScore - leftScore;
      });

    const selected = new Set<string>();
    const minMidpointSpacingPx = 75;

    for (const candidate of candidates) {
      const tooCloseToExisting = Array.from(selected).some((selectedId) => {
        const selectedSegment = projectedSegments.find(
          (segment) => segment.id === selectedId,
        );

        if (!selectedSegment) {
          return false;
        }

        return (
          Math.hypot(
            candidate.midX - selectedSegment.midX,
            candidate.midY - selectedSegment.midY,
          ) < minMidpointSpacingPx
        );
      });

      if (tooCloseToExisting) {
        continue;
      }

      selected.add(candidate.id);
    }

    return selected;
  }, [projectedSegments]);

  if (projectedSegments.length === 0) {
    return null;
  }

  return (
    <svg
      className={styles.routeOverlay}
      data-testid="journey-line-overlay"
      aria-hidden="true"
    >
      <defs>
        {routeGradient ? (
          <linearGradient
            id={routeGradient.id}
            gradientUnits="userSpaceOnUse"
            x1={routeGradient.x1}
            y1={routeGradient.y1}
            x2={routeGradient.x2}
            y2={routeGradient.y2}
          >
            {routeGradient.stops.map((stop) => (
              <stop
                key={`${routeGradient.id}-${stop.offset}`}
                offset={stop.offset}
                stopColor={stop.color}
              />
            ))}
          </linearGradient>
        ) : null}
      </defs>
      {projectedGhostPath ? (
        <path
          d={projectedGhostPath}
          className={styles.routeOverlayGhost}
          data-testid="journey-line-ghost-route"
          style={{
            strokeWidth: routeMode === "simplified" ? 3 : 2.5,
            strokeDasharray: "2 8",
          }}
        />
      ) : null}
      {projectedSegments.map((segment) => (
        <React.Fragment key={segment.id}>
          {(() => {
            const transferLeg = isTransferLeg(
              segment.distanceKm,
              segment.durationSeconds,
            );
            const dashCycle = transferLeg ? 28 : 16;

            return (
              <>
                <path
                  d={segment.d}
                  className={styles.routeOverlayPathCasing}
                  style={{
                    strokeWidth: (routeMode === "simplified" ? 4 : 3) + 2,
                    opacity: 0.64,
                  }}
                />
                <path
                  d={segment.d}
                  className={styles.routeOverlayPath}
                  data-testid="journey-line-segment"
                  style={{
                    stroke: routeGradient
                      ? `url(#${routeGradient.id})`
                      : segment.color,
                    strokeWidth:
                      routeMode === "simplified"
                        ? transferLeg
                          ? 4.8
                          : 3.6
                        : transferLeg
                          ? 3.8
                          : 2.7,
                    opacity:
                      routeMode === "simplified"
                        ? transferLeg
                          ? 0.94
                          : 0.82
                        : transferLeg
                          ? 0.9
                          : 0.72,
                    strokeDasharray: transferLeg ? "18 10" : "8 8",
                    ["--route-speed" as string]: `${segment.durationSeconds}s`,
                    ["--route-dash-cycle" as string]: dashCycle,
                  }}
                />
                {showSpeedLabels &&
                preferredLabelSegmentIds.has(segment.id) &&
                segment.approxSpeedKmh !== null &&
                (segment.distanceKm >= 5 || segment.lengthPx >= 24) ? (
                  <g
                    data-testid="journey-line-speed-label"
                    transform={`translate(${segment.midX} ${segment.midY}) rotate(${segment.angle})`}
                    style={{ opacity: 0.9 }}
                  >
                    <text className={styles.routeOverlayLabel}>
                      {`${segment.approxSpeedKmh}km/h · ${formatDistanceKm(
                        segment.distanceKm,
                      )}`}
                    </text>
                  </g>
                ) : null}
              </>
            );
          })()}
        </React.Fragment>
      ))}
      {routePoints && routePoints.length >= 2 ? (
        <>
          <g data-testid="journey-line-start">
            <circle
              className={styles.routeEndpointStart}
              cx={projectedSegments[0]?.startX}
              cy={projectedSegments[0]?.startY}
              r={4.75}
            />
          </g>
          <g data-testid="journey-line-end">
            <circle
              className={styles.routeEndpointEnd}
              cx={projectedSegments.at(-1)?.endX}
              cy={projectedSegments.at(-1)?.endY}
              r={5.25}
            />
            <circle
              className={styles.routeEndpointInner}
              cx={projectedSegments.at(-1)?.endX}
              cy={projectedSegments.at(-1)?.endY}
              r={1.6}
            />
          </g>
        </>
      ) : null}
    </svg>
  );
};

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
}) => {
  const url =
    typeof window === "undefined" ? null : new URL(window.location.toString());
  const initialLon = syncRoute ? (url?.searchParams.get("lon") ?? null) : null;
  const initialLat = syncRoute ? (url?.searchParams.get("lat") ?? null) : null;
  const initialZoom = syncRoute
    ? (url?.searchParams.get("zoom") ?? null)
    : null;

  const [zoom, setZoom] = React.useState<number | null>(
    initialZoom ? Number.parseFloat(initialZoom) : null,
  );
  const [isInteracting, setIsInteracting] = React.useState(false);

  const [bounds, setBounds] = React.useState<{
    north: number;
    south: number;
    east: number;
    west: number;
  } | null>(null);
  // Memoize date range calculations (Optimization #1)
  const dateStats = React.useMemo(() => {
    const sortedByDate = photos
      .slice()
      .filter((p) => p.date)
      .sort(
        (a, b) =>
          new Date(b.date ?? "").valueOf() - new Date(a.date ?? "").valueOf(),
      );
    const oldest = sortedByDate.at(0);
    const newest = sortedByDate.at(-1);
    const range =
      new Date(newest?.date ?? 0).valueOf() -
      new Date(oldest?.date ?? 0).valueOf();

    return { oldest, newest, range };
  }, [photos]);

  // Memoize sorted photos with pre-calculated marker styles (Optimization #2)
  const photosWithStyles = React.useMemo(() => {
    return photos
      .slice()
      .sort((a, b) => {
        // sort so newer markers are on top
        return (
          new Date(a.date ?? "").valueOf() - new Date(b.date ?? "").valueOf()
        );
      })
      .map((photo): PhotoWithStyle => {
        const relative =
          (new Date(photo.date ?? dateStats.oldest?.date ?? "").valueOf() -
            new Date(dateStats.oldest?.date ?? 0).valueOf()) /
          dateStats.range;

        return {
          ...photo,
          relative,
          markerColor: `hsl(${relative * 220}, 100%, ${50 - relative * 30}%)`,
          hueRotate: `hue-rotate(${relative * 255}deg)`,
        };
      });
  }, [photos, dateStats]);

  // Filter photos by viewport bounds (Optimization #3)
  const visiblePhotos = React.useMemo(() => {
    if (!bounds) {
      return photosWithStyles;
    }

    return photosWithStyles.filter((photo) => {
      if (!photo.decLat || !photo.decLng) return false;

      return (
        photo.decLat >= bounds.south &&
        photo.decLat <= bounds.north &&
        photo.decLng >= bounds.west &&
        photo.decLng <= bounds.east
      );
    });
  }, [photosWithStyles, bounds]);

  const [clickInfo, setClickInfo] = React.useState<MapWorldEntry | null>(null);
  const [hoverInfo, setHoverInfo] = React.useState<MapWorldEntry | null>(null);
  const lastSyncedRouteRef = React.useRef<string>("");
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pauseUntilRef = React.useRef<number>(0);
  const popupInfo = clickInfo ?? hoverInfo;
  const routeDataByAlbum = React.useMemo(() => {
    const albums = new globalThis.Map<string, MapWorldEntry[]>();
    photos.forEach((photo) => {
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
  }, [photos]);
  const activeRouteTarget = clickInfo?.href ?? hoverInfo?.href ?? null;
  const activeRoutePhoto = React.useMemo(
    () =>
      photosWithStyles.find((photo) => photo.href === activeRouteTarget) ??
      null,
    [activeRouteTarget, photosWithStyles],
  );
  const activeContextRoutePoints = React.useMemo(() => {
    if (!activeRouteTarget) {
      return null;
    }

    return buildContextRoutePoints(photos, activeRouteTarget, routeMode);
  }, [activeRouteTarget, photos, routeMode]);
  const activeContextRouteGeoJson = React.useMemo(
    () => toRouteGeoJson(activeContextRoutePoints ?? []),
    [activeContextRoutePoints],
  );
  const markerColorByHref = React.useMemo(
    () =>
      new globalThis.Map(
        photosWithStyles.map(
          (photo) => [photo.href, photo.markerColor] as const,
        ),
      ),
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
  const alwaysVisibleRouteGeoJson = React.useMemo(() => {
    if (!showRoute || routeDisplayMode !== "always") {
      return null;
    }

    if (fullRoutePoints) {
      return toRouteGeoJson(fullRoutePoints);
    }

    const features = Array.from(routeDataByAlbum.entries()).flatMap(
      ([album, route]) => {
        const points =
          routeMode === "simplified" ? route.simplifiedPoints : route.fullPoints;
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
      },
    );

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
    (point: RoutePoint, index: number) => {
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

    if (e.viewState.latitude !== 0) {
      searchParams.set("lat", e.viewState.latitude.toFixed(3).toString());
    }

    if (e.viewState.longitude !== 0) {
      searchParams.set("lon", e.viewState.longitude.toFixed(3).toString());
    }

    if (e.viewState.zoom !== 1) {
      searchParams.set("zoom", e.viewState.zoom.toFixed(2).toString());
    }

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
          <Source
            id="journey-line-source"
            type="geojson"
            data={routeGeoJson}
            lineMetrics
          >
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
                    ? [
                        "interpolate",
                        ["linear"],
                        ["line-progress"],
                        0,
                        2.4,
                        0.32,
                        6.2,
                        1,
                        10.2,
                      ]
                    : routeLineWidth + 4,
              }}
            />
            <Layer
              id="journey-line-layer"
              type="line"
              paint={{
                "line-color":
                  routeDataByAlbum.size > 1
                    ? "#12bcd4"
                    : (routeColorStops[1]?.color ?? "#12bcd4"),
                "line-gradient":
                  routeDataByAlbum.size > 1
                    ? [
                        "interpolate",
                        ["linear"],
                        ["line-progress"],
                        0,
                        ["coalesce", ["get", "routeColorStart"], "#0f4b6e"],
                        0.24,
                        ["coalesce", ["get", "routeColorQuarter"], "#145b83"],
                        0.58,
                        ["coalesce", ["get", "routeColorMiddle"], "#12bcd4"],
                        1,
                        ["coalesce", ["get", "routeColorEnd"], "#b9fbff"],
                      ]
                    : undefined,
                "line-opacity": alwaysVisibleRouteGeoJson
                  ? routeDataByAlbum.size > 1
                    ? 1
                    : routeMode === "simplified"
                      ? 0.55
                      : 0.78
                  : 0.24,
                "line-width":
                  routeDataByAlbum.size > 1
                    ? [
                        "interpolate",
                        ["linear"],
                        ["line-progress"],
                        0,
                        1.1,
                        0.32,
                        4.8,
                        1,
                        8,
                      ]
                    : routeLineWidth,
                "line-dasharray": routeDataByAlbum.size > 1 ? undefined : [2, 2],
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

        {popupInfo && popupInfo.decLat && popupInfo.decLng ? (
          <Popup
            longitude={popupInfo.decLng}
            latitude={popupInfo.decLat}
            onClose={() => {
              setClickInfo(null);
            }}
            className={`${styles.popup} ${
              clickInfo ? styles.click : styles.hover
            }`}
            offset={15}
            closeButton={false}
          >
            <div
              onMouseDownCapture={pauseRouterSync}
              onTouchStartCapture={pauseRouterSync}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <Link href={popupInfo.href ?? ""} className={styles.link}>
                <img
                  src={popupInfo.src.src}
                  className={styles.image}
                  width={popupInfo.placeholderWidth}
                  height={popupInfo.placeholderHeight}
                  style={{ backgroundColor: popupInfo.placeholderColor }}
                  alt={popupInfo.album}
                />
                <div className={styles.details}>
                  {popupInfo.album}
                  <br />
                  <span>
                    {new Date(popupInfo.date ?? "").toLocaleString()}
                    <br />
                    {getRelativeTimeString(new Date(popupInfo.date ?? ""))}
                  </span>
                </div>
              </Link>

              {clickInfo ? (
                <div className={styles.viewOn}>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${popupInfo.decLat}&mlon=${popupInfo.decLng}&zoom=13`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    OpenStreetMaps
                  </a>
                  &nbsp;&middot;&nbsp;
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${popupInfo.decLat},${popupInfo.decLng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google Maps
                  </a>
                </div>
              ) : null}
            </div>
          </Popup>
        ) : null}

        {visiblePhotos.map((photo) => {
          return photo.decLat && photo.decLng ? (
            <React.Fragment key={photo.href ?? photo?.src?.src ?? ""}>
              <Marker
                longitude={photo.decLng}
                latitude={photo.decLat}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setClickInfo(photo);
                }}
                color={photo.markerColor}
              >
                <div>
                  {zoom && zoom > 8.5 ? <LazyImage photo={photo} /> : null}
                  <span
                    style={{ color: photo.markerColor }}
                    className={[
                      styles.pin,
                      shouldEmphasizeRouteMarkers && activeRouteHrefSet.size > 0
                        ? activeRouteHrefSet.has(photo.href)
                          ? styles.pinActive
                          : styles.pinMuted
                        : "",
                    ].join(" ")}
                    onMouseOver={() => {
                      setHoverInfo(photo);
                    }}
                    onMouseLeave={() => {
                      setHoverInfo(null);
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
        <FullscreenControl />
      </MapLibreMap>
    </div>
  );
};

export default MMap;
