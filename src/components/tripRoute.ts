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

const FIT_PADDING_PX = 56;
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
  if (bounds) map.fitBounds(bounds, { padding: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM });
};
