import { exifWallClockTimestamp } from "../util/exifTime";
import { unwrapLongitudes } from "../util/mapBounds";
import { mixHsl } from "../util/mapColor";
import { distanceMetersBetween, type RoutePoint } from "./mapRoute";

type ProjectedPoint = { x: number; y: number };
export type ProjectPoint = (coordinates: [number, number]) => ProjectedPoint | null | undefined;

export type ProjectedRouteSegment = {
  id: string;
  d: string;
  color: string;
  approxSpeedKmh: number | null;
  durationSeconds: number;
  distanceKm: number;
  midX: number;
  midY: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  angle: number;
  lengthPx: number;
};

type RouteViewport = { width: number; height: number };

/**
 * Keep the SVG detail layer proportional to what the reader can see.
 *
 * At a city zoom, a multi-country journey can project tens of thousands of
 * pixels beyond the map. Drawing and animating every off-screen leg makes the
 * browser repaint that enormous SVG even though MapLibre already carries the
 * complete journey on the GPU underneath. Clip crossing legs at the padded
 * viewport too: hiding their overflow does not stop Firefox animating the full
 * off-screen stroke.
 */
export const clipRouteSegmentsToViewport = (
  segments: ProjectedRouteSegment[],
  viewport: RouteViewport,
  padding = 64,
): ProjectedRouteSegment[] => {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return segments;
  }

  const left = -padding;
  const top = -padding;
  const right = viewport.width + padding;
  const bottom = viewport.height + padding;

  return segments.flatMap((segment) => {
    const dx = segment.endX - segment.startX;
    const dy = segment.endY - segment.startY;
    let startRatio = 0;
    let endRatio = 1;
    const edges: Array<[number, number]> = [
      [-dx, segment.startX - left],
      [dx, right - segment.startX],
      [-dy, segment.startY - top],
      [dy, bottom - segment.startY],
    ];

    for (const [direction, distance] of edges) {
      if (direction === 0) {
        if (distance < 0) {
          return [];
        }
        continue;
      }

      const ratio = distance / direction;
      if (direction < 0) {
        startRatio = Math.max(startRatio, ratio);
      } else {
        endRatio = Math.min(endRatio, ratio);
      }
      if (startRatio > endRatio) {
        return [];
      }
    }

    if (startRatio === 0 && endRatio === 1) {
      return [segment];
    }

    const startX = segment.startX + startRatio * dx;
    const startY = segment.startY + startRatio * dy;
    const endX = segment.startX + endRatio * dx;
    const endY = segment.startY + endRatio * dy;
    const clippedDx = endX - startX;
    const clippedDy = endY - startY;
    const length = Math.hypot(clippedDx, clippedDy);
    const normalX = length > 0 ? -clippedDy / length : 0;
    const normalY = length > 0 ? clippedDx / length : 0;
    const roundedStartX = Number(startX.toFixed(2));
    const roundedStartY = Number(startY.toFixed(2));
    const roundedEndX = Number(endX.toFixed(2));
    const roundedEndY = Number(endY.toFixed(2));

    return [
      {
        ...segment,
        d: `M ${roundedStartX.toFixed(2)} ${roundedStartY.toFixed(2)} L ${roundedEndX.toFixed(2)} ${roundedEndY.toFixed(2)}`,
        startX: roundedStartX,
        startY: roundedStartY,
        endX: roundedEndX,
        endY: roundedEndY,
        midX: Number(((startX + endX) / 2 + normalX * 10).toFixed(2)),
        midY: Number(((startY + endY) / 2 + normalY * 10).toFixed(2)),
        lengthPx: length,
      },
    ];
  });
};

export const getDirectionalGradientStops = (fromColor: string, toColor: string) => [
  { offset: "0%", color: fromColor },
  { offset: "50%", color: mixHsl(fromColor, toColor, 0.5) },
  { offset: "100%", color: toColor },
];

export const getAnimationSecondsFromSpeed = (speedKmh: number | null): number => {
  if (speedKmh === null || speedKmh <= 0) {
    return 1.8;
  }

  const log = Math.log10(Math.min(1000, Math.max(1, speedKmh)));
  return Number((2.5 - log * 0.67).toFixed(2));
};

const getDistanceKm = (fromPoint: RoutePoint, toPoint: RoutePoint): number =>
  distanceMetersBetween(
    { decLat: fromPoint.decLat as number, decLng: fromPoint.decLng as number },
    { decLat: toPoint.decLat as number, decLng: toPoint.decLng as number },
  ) / 1000;

const getDurationSeconds = (fromPoint: RoutePoint, toPoint: RoutePoint): number => {
  const fromMs = exifWallClockTimestamp(fromPoint.date);
  const toMs = exifWallClockTimestamp(toPoint.date);
  return fromMs === null || toMs === null ? 0 : Math.abs(toMs - fromMs) / 1000;
};

const getApproxSpeedKmh = (fromPoint: RoutePoint, toPoint: RoutePoint): number | null => {
  const fromMs = exifWallClockTimestamp(fromPoint.date);
  const toMs = exifWallClockTimestamp(toPoint.date);
  if (fromMs === null || toMs === null || toMs <= fromMs) {
    return null;
  }

  const distanceKm = getDistanceKm(fromPoint, toPoint);
  if (distanceKm < 0.1) {
    return null;
  }

  const speed = distanceKm / ((toMs - fromMs) / (60 * 60 * 1000));
  return Number.isFinite(speed) && speed >= 1 && speed <= 500 ? Math.round(speed) : null;
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

export const projectRouteSegments = (
  routePoints: RoutePoint[],
  project: ProjectPoint,
  getPointColor: (point: RoutePoint, index: number) => string,
): ProjectedRouteSegment[] => {
  if (routePoints.length < 2) {
    return [];
  }

  const unwrappedLngs = unwrapLongitudes(routePoints.map((point) => point.decLng as number));

  return routePoints.slice(0, -1).flatMap((point, index) => {
    // slice(0, -1) guarantees a following point for every visited index.
    const nextPoint = routePoints[index + 1]!;

    const start = project([unwrappedLngs[index] as number, point.decLat as number]);
    const end = project([unwrappedLngs[index + 1] as number, nextPoint.decLat as number]);
    if (
      typeof start?.x !== "number" ||
      typeof start.y !== "number" ||
      typeof end?.x !== "number" ||
      typeof end.y !== "number"
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
        approxSpeedKmh: getApproxSpeedKmh(point, nextPoint),
        durationSeconds: getDurationSeconds(point, nextPoint),
        distanceKm: getDistanceKm(point, nextPoint),
        midX: Number(((start.x + end.x) / 2 + normalX * 10).toFixed(2)),
        midY: Number(((start.y + end.y) / 2 + normalY * 10).toFixed(2)),
        startX: Number(start.x.toFixed(2)),
        startY: Number(start.y.toFixed(2)),
        endX: Number(end.x.toFixed(2)),
        endY: Number(end.y.toFixed(2)),
        angle: Number(getReadableLabelAngle((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(2)),
        lengthPx: length,
      },
    ];
  });
};

export const projectGhostRoutePath = (
  routePoints: RoutePoint[],
  project: ProjectPoint,
): string | null => {
  if (routePoints.length < 2) {
    return null;
  }

  const unwrappedLngs = unwrapLongitudes(routePoints.map((point) => point.decLng as number));
  const points = routePoints
    .map((point, index) => project([unwrappedLngs[index] as number, point.decLat as number]))
    .filter((point): point is ProjectedPoint => {
      return typeof point?.x === "number" && typeof point.y === "number";
    });

  return points.length < 2
    ? null
    : points
        .map(
          (point, index) =>
            `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
        )
        .join(" ");
};

export const selectPreferredLabelSegmentIds = (segments: ProjectedRouteSegment[]): Set<string> => {
  const candidates = segments
    .filter(
      (segment) =>
        segment.approxSpeedKmh !== null && (segment.distanceKm >= 5 || segment.lengthPx >= 24),
    )
    .sort((left, right) => right.lengthPx - left.lengthPx);

  const selected = new Set<string>();
  for (const candidate of candidates) {
    const tooClose = Array.from(selected).some((selectedId) => {
      // IDs enter the set only from this same segment collection.
      const selectedSegment = segments.find((segment) => segment.id === selectedId)!;
      return (
        Math.hypot(candidate.midX - selectedSegment.midX, candidate.midY - selectedSegment.midY) <
        75
      );
    });

    if (!tooClose) {
      selected.add(candidate.id);
    }
  }

  return selected;
};

export const formatDistanceKm = (distanceKm: number): string =>
  distanceKm >= 10 ? `${Math.round(distanceKm)}km` : `${distanceKm.toFixed(1)}km`;

export const isTransferLeg = (distanceKm: number, durationSeconds: number): boolean =>
  distanceKm >= 12 || durationSeconds / 3600 >= 2;
