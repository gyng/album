import type { Trip } from "../util/computeTrips";

/**
 * A trip's route as data: which days can be placed, where, and how to draw the
 * line between them.
 *
 * Drawn on its own rather than over a basemap. A map per trip meant a WebGL
 * context and a tile request each, on a page that lists ninety-four of them —
 * enough to exhaust the tile provider's quota, at which point every map on the
 * site goes blank. The shape of a journey needs neither.
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
 * Every photograph of a trip that knows where it was taken.
 *
 * One stop per *photograph*, not per day: a day put a single pin on the map
 * however many frames it held, so a six-photograph afternoon showed one marker
 * and said nothing about where the other five were. Each stop still carries its
 * day's number, so the numbering along the route stays the journey's rather
 * than becoming a count of frames.
 *
 * A day with no located photograph takes no number, so the numbers are
 * positions in the *route* — a trip whose third day carries no coordinates
 * draws two, not a gap.
 */
export const routeStops = (trip: Trip): RouteStop[] => {
  const stops: RouteStop[] = [];
  let number = 0;

  for (const day of trip.days) {
    const located = day.photos.filter(
      (photo): photo is typeof photo & { lat: number; lng: number } =>
        typeof photo.lat === "number" && typeof photo.lng === "number",
    );
    if (located.length === 0 && !day.point) continue;
    number += 1;

    // A day whose frames arrived without coordinates can still be placed by the
    // day's own point.
    const points =
      located.length > 0
        ? located.map((photo) => ({ lat: photo.lat, lng: photo.lng, src: photo.src }))
        : [{ lat: day.point!.lat, lng: day.point!.lng, src: day.photos[0]?.src }];

    for (const photo of points) {
      stops.push({
        date: day.date,
        number,
        lat: photo.lat,
        lng: photo.lng,
        ...(photo.src ? { src: photo.src } : {}),
        label: day.places[0] ?? day.date,
      });
    }
  }

  return stops;
};

export type ProjectedPoint = { x: number; y: number };

export type ProjectedRoute = {
  /** The line through the stops, in order, as SVG path data. */
  path: string;
  /** Where each stop landed, in the same order it was given. */
  points: ProjectedPoint[];
  /**
   * The same projection, for anything else drawn in this space — the markers
   * are a clustered subset of the stops, and projecting them separately would
   * fit them to their own extent and pull them off the line.
   */
  project: (place: { lat: number; lng: number }) => ProjectedPoint;
  width: number;
  height: number;
};

/**
 * Web Mercator, so a route keeps the shape a map would have given it.
 *
 * Both axes in radians. Taking x in degrees and y from the Mercator formula —
 * which is in radians — squashed every route by a factor of 180/π: a journey
 * with real north-south extent came out as a nearly flat line.
 */
const mercatorX = (lng: number) => (lng * Math.PI) / 180;

const mercatorY = (lat: number) => {
  const clamped = Math.max(-85.05, Math.min(85.05, lat));
  const radians = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
};

/**
 * How tall the route wants to be drawn, for a given width.
 *
 * A journey that ran east–west is a wide, shallow shape; given a square frame
 * it becomes a thin line adrift in empty space. The frame takes the journey's
 * proportions instead, within limits — a route that ran due north still needs
 * width enough to read, and one that barely moved should not become a stripe.
 */
export const routeFrameHeight = (
  stops: RouteStop[],
  width: number,
  padding: number,
  min: number,
  max: number,
): number => {
  if (stops.length === 0) return min;
  const xs = stops.map((stop) => mercatorX(stop.lng));
  const ys = stops.map((stop) => mercatorY(stop.lat));
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  if (spanX === 0 || spanY === 0) return min;
  const inner = Math.max(1, width - padding * 2);
  return Math.round(Math.min(max, Math.max(min, (spanY / spanX) * inner + padding * 2)));
};

/**
 * The route drawn on its own, without a basemap under it.
 *
 * Scaled to fit the box and centred, with one scale for both axes so the shape
 * is the journey's rather than the box's. A trip that never moved collapses to
 * a single point in the middle rather than dividing by a zero extent.
 */
export const projectRoute = (
  stops: RouteStop[],
  width: number,
  height: number,
  padding: number,
): ProjectedRoute => {
  const inner = {
    width: Math.max(1, width - padding * 2),
    height: Math.max(1, height - padding * 2),
  };
  const xs = stops.map((stop) => mercatorX(stop.lng));
  const ys = stops.map((stop) => mercatorY(stop.lat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const scale =
    spanX === 0 && spanY === 0
      ? 1
      : Math.min(
          spanX === 0 ? Infinity : inner.width / spanX,
          spanY === 0 ? Infinity : inner.height / spanY,
        );

  const drawnWidth = spanX * scale;
  const drawnHeight = spanY * scale;
  const offsetX = padding + (inner.width - drawnWidth) / 2;
  const offsetY = padding + (inner.height - drawnHeight) / 2;

  const project = (place: { lat: number; lng: number }): ProjectedPoint => ({
    x: spanX === 0 ? width / 2 : offsetX + (mercatorX(place.lng) - minX) * scale,
    // Mercator y grows northward; SVG grows downward.
    y: spanY === 0 ? height / 2 : offsetY + (maxY - mercatorY(place.lat)) * scale,
  });

  const points = stops.map(project);

  return {
    project,
    path: points
      .map(
        (point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
      )
      .join(" "),
    points,
    width,
    height,
  };
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
const CLUSTER_FRACTION_OF_SPAN = 0.04;
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
      // A marker covering eight frames of one day names that day once.
      if (!near.numbers.includes(stop.number)) near.numbers.push(stop.number);
      if (!near.dates.includes(stop.date)) near.dates.push(stop.date);
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
