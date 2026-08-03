import type { Trip } from "../util/computeTrips";
import type { Bounds, MapCamera } from "./map";

/**
 * A trip's route as data: which days can be placed, where, and how the map
 * should be framed to show them.
 *
 * Kept apart from the component the way `mapRoute.ts` is, so the logic can be
 * tested without resolving MapLibre — the adapter is a browser package and a
 * node test cannot load it.
 */
/** A day that knows where it was, with its position in the journey. */
export type RouteStop = {
  date: string;
  number: number;
  lat: number;
  lng: number;
  src?: string;
  label: string;
};

/**
 * Room kept around the fitted route.
 *
 * Asymmetric because a marker is asymmetric: the picture stands ~92px above its
 * pin, so a stop near the top of the frame has its photograph cut off by the
 * map's own edge while the bottom has room to spare. Same failure the world
 * map's render padding exists to avoid.
 */
const FIT_PADDING = { top: 84, right: 40, bottom: 32, left: 40 };
/** A trip that never left one place still needs a readable frame. */
const SINGLE_STOP_ZOOM = 11;
const FIT_MAX_ZOOM = 12;

/**
 * The days of a trip that can be placed, numbered in order.
 *
 * A day with no located photograph is skipped rather than guessed at, so the
 * numbers are positions in the *route*, not day numbers — a trip whose third
 * day carries no coordinates draws two stops, not a gap.
 */
export const routeStops = (trip: Trip): RouteStop[] =>
  trip.days
    .filter(
      (day): day is typeof day & { point: { lat: number; lng: number } } => day.point !== null,
    )
    .map((day, index) => ({
      date: day.date,
      number: index + 1,
      lat: day.point.lat,
      lng: day.point.lng,
      ...(day.photos[0]?.src ? { src: day.photos[0].src } : {}),
      label: day.places[0] ?? day.date,
    }));

/** The rectangle enclosing every stop, or null when there is nothing to frame. */
export const routeBounds = (stops: RouteStop[]): Bounds | null => {
  if (stops.length === 0) return null;
  const lats = stops.map((stop) => stop.lat);
  const lngs = stops.map((stop) => stop.lng);
  return [
    { lng: Math.min(...lngs), lat: Math.min(...lats) },
    { lng: Math.max(...lngs), lat: Math.max(...lats) },
  ];
};

/**
 * Frames the whole journey.
 *
 * Run from `onLoad` rather than a child effect: a child mounts as soon as the
 * map object exists, which is before the style and the canvas are up, and a fit
 * requested then is computed against a map that cannot yet honour it — the
 * route opened at world view with fourteen markers scattered off-screen.
 */
export const fitToRoute = (map: MapCamera, stops: RouteStop[]): void => {
  const first = stops[0];
  if (!first) return;

  if (stops.length === 1) {
    map.jumpTo({ center: { lng: first.lng, lat: first.lat }, zoom: SINGLE_STOP_ZOOM });
    return;
  }

  const bounds = routeBounds(stops);
  if (bounds) map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM });
};

/**
 * A marker on the route: one picture, standing for the days it covers.
 *
 * Days in the same city land on the same pixel, and a stack of thumbnails shows
 * only its top one — on a real fourteen-day trip nine of the fourteen were
 * hidden behind another. Grouping them makes every day visible *somewhere*
 * rather than silently discarded.
 */
export type RouteMarker = {
  key: string;
  lat: number;
  lng: number;
  src?: string;
  /** Positions in the route this marker stands for, ascending. */
  numbers: number[];
  /** The days themselves, so hovering one in the list can raise its marker. */
  dates: string[];
  label: string;
};

/**
 * How close two stops must be to share a marker, as a fraction of the trip's
 * own extent.
 *
 * A fixed distance cannot work: the map is fitted to the trip, so a fortnight
 * across a country and an afternoon across a city are drawn at wildly different
 * scales, and the only thing that stays constant is how much of the frame a
 * marker takes. A thumbnail is 80px in a ~320px frame, so stops within roughly
 * a tenth of the span would overlap.
 */
const CLUSTER_FRACTION_OF_SPAN = 0.12;
/** A trip that never moved still needs one marker, not a division by zero. */
const MIN_CLUSTER_TOLERANCE_DEG = 0.0005;

export const clusterStops = (stops: RouteStop[]): RouteMarker[] => {
  if (stops.length === 0) return [];

  const span = Math.max(
    Math.max(...stops.map((stop) => stop.lat)) - Math.min(...stops.map((stop) => stop.lat)),
    Math.max(...stops.map((stop) => stop.lng)) - Math.min(...stops.map((stop) => stop.lng)),
  );
  const tolerance = Math.max(span * CLUSTER_FRACTION_OF_SPAN, MIN_CLUSTER_TOLERANCE_DEG);

  const markers: RouteMarker[] = [];
  for (const stop of stops) {
    const near = markers.find(
      (marker) =>
        Math.abs(marker.lat - stop.lat) <= tolerance &&
        Math.abs(marker.lng - stop.lng) <= tolerance,
    );
    if (near) {
      near.numbers.push(stop.number);
      near.dates.push(stop.date);
      // The picture stays the first day's: a marker should not change what it
      // shows depending on how many days happened to join it.
      if (!near.src && stop.src) near.src = stop.src;
      continue;
    }
    markers.push({
      key: stop.date,
      lat: stop.lat,
      lng: stop.lng,
      ...(stop.src ? { src: stop.src } : {}),
      numbers: [stop.number],
      dates: [stop.date],
      label: stop.label,
    });
  }

  return markers;
};

/** Beyond this the list is longer than the pin it sits on. */
const MAX_LISTED_DAYS = 3;

/**
 * "6", "6–8", "6, 8", or "6 days".
 *
 * A run reads as a range and a couple of gaps can be spelled out, but a base a
 * traveller kept returning to collects days all over the trip — "1, 6, 7, 8,
 * 11, 14" is wider than the marker and tells the reader less than the count.
 */
export const formatDayNumbers = (numbers: number[]): string => {
  const sorted = [...numbers].sort((left, right) => left - right);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return "";
  if (sorted.length === 1) return String(first);
  const isRun = sorted.every((value, index) => value === first + index);
  if (isRun) return `${first}–${last}`;
  return sorted.length <= MAX_LISTED_DAYS ? sorted.join(", ") : `${sorted.length} days`;
};
