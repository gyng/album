import type { MapWorldEntry } from "./MapWorld";

export const ROUTE_SIMPLIFY_THRESHOLD = 80;
const CONTEXT_WHOLE_TRIP_MAX_SPAN_DAYS = 28;
const DEFAULT_NEARBY_DISTANCE_METERS = 250;
const DEFAULT_NEARBY_TIME_WINDOW_MS = 45 * 60 * 1000;

export type RouteMode = "full" | "simplified";

export type RouteGeoJson = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: {
      type: "LineString";
      coordinates: [number, number][];
    };
  }>;
};

export type RoutePoint = MapWorldEntry & {
  isStart: boolean;
  isEnd: boolean;
  sequenceIndex: number;
  stopPhotoCount: number;
  memberHrefs: string[];
};

type BuildMapRouteOptions = {
  nearbyDistanceMeters?: number;
  nearbyTimeWindowMs?: number;
};

const isFiniteCoordinate = (
  value: number | null | undefined,
): value is number => typeof value === "number" && Number.isFinite(value);

const parseTimestamp = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).valueOf();
  return Number.isNaN(timestamp) ? null : timestamp;
};

export const distanceMetersBetween = (
  left: { decLat: number; decLng: number },
  right: { decLat: number; decLng: number },
): number => {
  const earthRadiusMeters = 6_371_000;
  const lat1 = (left.decLat * Math.PI) / 180;
  const lat2 = (right.decLat * Math.PI) / 180;
  const deltaLat = ((right.decLat - left.decLat) * Math.PI) / 180;
  const deltaLng = ((right.decLng - left.decLng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const toRouteGeoJson = (points: RoutePoint[]): RouteGeoJson | null => {
  if (points.length < 2) {
    return null;
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          pointCount: points.length,
        },
        geometry: {
          type: "LineString",
          coordinates: points.map((point) => [
            point.decLng as number,
            point.decLat as number,
          ]),
        },
      },
    ],
  };
};

const withRouteMetadata = (points: MapWorldEntry[]): RoutePoint[] =>
  points.map((point, index) => ({
    ...point,
    sequenceIndex: index,
    isStart: index === 0,
    isEnd: index === points.length - 1,
    stopPhotoCount: 1,
    memberHrefs: [point.href],
  }));

const simplifyRoutePoints = (
  points: RoutePoint[],
  options?: BuildMapRouteOptions,
): RoutePoint[] => {
  if (points.length <= 2) {
    return points;
  }

  const nearbyDistanceMeters =
    options?.nearbyDistanceMeters ?? DEFAULT_NEARBY_DISTANCE_METERS;
  const nearbyTimeWindowMs =
    options?.nearbyTimeWindowMs ?? DEFAULT_NEARBY_TIME_WINDOW_MS;
  const simplified: RoutePoint[] = [];

  for (const point of points) {
    const previous = simplified.at(-1);
    if (!previous) {
      simplified.push(point);
      continue;
    }

    const previousTimestamp = parseTimestamp(previous.date);
    const currentTimestamp = parseTimestamp(point.date);
    const withinTimeWindow =
      previousTimestamp !== null &&
      currentTimestamp !== null &&
      Math.abs(currentTimestamp - previousTimestamp) <= nearbyTimeWindowMs;
    const withinDistance =
      distanceMetersBetween(
        {
          decLat: previous.decLat as number,
          decLng: previous.decLng as number,
        },
        { decLat: point.decLat as number, decLng: point.decLng as number },
      ) <= nearbyDistanceMeters;

    if (withinTimeWindow && withinDistance) {
      simplified[simplified.length - 1] = {
        ...previous,
        stopPhotoCount: previous.stopPhotoCount + 1,
        isEnd: point.isEnd,
        memberHrefs: [...previous.memberHrefs, point.href],
      };
      continue;
    }

    simplified.push(point);
  }

  return simplified.map((point, index) => ({
    ...point,
    sequenceIndex: index,
    isStart: index === 0,
    isEnd: index === simplified.length - 1,
  }));
};

export const getDefaultRouteMode = (photos: MapWorldEntry[]): RouteMode => {
  const geotaggedCount = photos.filter(
    (photo) =>
      isFiniteCoordinate(photo.decLat) && isFiniteCoordinate(photo.decLng),
  ).length;

  return geotaggedCount > ROUTE_SIMPLIFY_THRESHOLD ? "simplified" : "full";
};

export const buildMapRoute = (
  photos: MapWorldEntry[],
  options?: BuildMapRouteOptions,
): {
  geotaggedCount: number;
  fullPoints: RoutePoint[];
  simplifiedPoints: RoutePoint[];
  fullRouteGeoJson: RouteGeoJson | null;
  simplifiedRouteGeoJson: RouteGeoJson | null;
} => {
  const ordered = photos
    .map((photo, originalIndex) => ({ photo, originalIndex }))
    .filter(
      (
        candidate,
      ): candidate is {
        photo: MapWorldEntry & { decLat: number; decLng: number };
        originalIndex: number;
      } =>
        isFiniteCoordinate(candidate.photo.decLat) &&
        isFiniteCoordinate(candidate.photo.decLng),
    )
    .sort((left, right) => {
      const leftTimestamp = parseTimestamp(left.photo.date);
      const rightTimestamp = parseTimestamp(right.photo.date);

      if (leftTimestamp !== null && rightTimestamp !== null) {
        if (leftTimestamp !== rightTimestamp) {
          return leftTimestamp - rightTimestamp;
        }
      } else if (leftTimestamp !== null || rightTimestamp !== null) {
        return leftTimestamp !== null ? -1 : 1;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(({ photo }) => photo);

  const fullPoints = withRouteMetadata(ordered);
  const simplifiedPoints = simplifyRoutePoints(fullPoints, options);

  return {
    geotaggedCount: fullPoints.length,
    fullPoints,
    simplifiedPoints,
    fullRouteGeoJson: toRouteGeoJson(fullPoints),
    simplifiedRouteGeoJson: toRouteGeoJson(simplifiedPoints),
  };
};

const getSegmentKey = (date: string | null | undefined): string | null => {
  const timestamp = parseTimestamp(date);
  if (timestamp === null) {
    return null;
  }

  return new Date(timestamp).toISOString().slice(0, 10);
};

const getTripSpanDays = (points: RoutePoint[]): number | null => {
  const timestamps = points
    .map((point) => parseTimestamp(point.date))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  if (timestamps.length === 0) {
    return null;
  }

  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];
  const dayMs = 24 * 60 * 60 * 1000;

  return Math.floor((last - first) / dayMs) + 1;
};

export const splitIntoRouteSegments = (points: RoutePoint[]): RoutePoint[][] => {
  if (points.length === 0) {
    return [];
  }

  const segments: RoutePoint[][] = [];
  let currentSegment: RoutePoint[] = [];

  for (const point of points) {
    const previous = currentSegment.at(-1);

    if (!previous) {
      currentSegment.push(point);
      continue;
    }

    const sameDay = getSegmentKey(previous.date) === getSegmentKey(point.date);
    const breaksSegment = !sameDay;

    if (breaksSegment) {
      segments.push(currentSegment);
      currentSegment = [point];
      continue;
    }

    currentSegment.push(point);
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
};

export const buildContextRoutePoints = (
  photos: MapWorldEntry[],
  targetHref: string,
  routeMode: RouteMode = "full",
): RoutePoint[] | null => {
  const target = photos.find((photo) => photo.href === targetHref);
  if (!target) {
    return null;
  }

  const route = buildMapRoute(
    photos.filter((photo) => photo.album === target.album),
  );
  const points =
    routeMode === "simplified" ? route.simplifiedPoints : route.fullPoints;
  const tripSpanDays = getTripSpanDays(points);

  if (
    tripSpanDays !== null &&
    tripSpanDays <= CONTEXT_WHOLE_TRIP_MAX_SPAN_DAYS
  ) {
    return points;
  }

  const segment = splitIntoRouteSegments(points).find((candidate) =>
    candidate.some((point) => point.memberHrefs.includes(targetHref)),
  );

  return segment ?? null;
};

export const buildContextRouteGeoJson = (
  photos: MapWorldEntry[],
  targetHref: string,
  routeMode: RouteMode = "full",
): RouteGeoJson | null => {
  const points = buildContextRoutePoints(photos, targetHref, routeMode);
  if (!points) {
    return null;
  }

  return toRouteGeoJson(points);
};
