import React from "react";
import type { Trip } from "../util/computeTrips";
import { clusterStops, projectRoute, routeFrameHeight, routeStops } from "./tripRoute";
import styles from "./TripRoutePath.module.css";

/** The drawing's own coordinate space; CSS scales it to whatever column it gets. */
const VIEW_WIDTH = 320;
/** The frame follows the journey's shape between these. */
const MIN_HEIGHT = 110;
const MAX_HEIGHT = 280;
/** Room for a marker and its label at the edges of the frame. */
const PADDING = 26;

export type TripRoutePathProps = {
  trip: Trip;
  /** The day the reader is pointing at in the trip, if any. */
  activeDate?: string | null;
};

/**
 * A trip's route, drawn on its own.
 *
 * There is no basemap under it, deliberately. A live map per trip cost a WebGL
 * context and a tile request each on a page that lists ninety-four journeys,
 * which is enough to exhaust the tile provider's free quota — and when that
 * happens every map on the site goes blank at once. The shape of a journey, its
 * order and its distances need none of that: this is SVG, it renders with the
 * page rather than after it, and it costs nothing to show.
 *
 * The line runs through every located photograph in order; the dots are the
 * clusters, so frames taken in the same spot share one.
 */
export const TripRoutePath = ({ trip, activeDate }: TripRoutePathProps) => {
  const stops = React.useMemo(() => routeStops(trip), [trip]);
  const markers = React.useMemo(() => clusterStops(stops), [stops]);
  const height = React.useMemo(
    () => routeFrameHeight(stops, VIEW_WIDTH, PADDING, MIN_HEIGHT, MAX_HEIGHT),
    [stops],
  );
  const route = React.useMemo(
    () => projectRoute(stops, VIEW_WIDTH, height, PADDING),
    [stops, height],
  );

  // Only the ends are named. A day number over every cluster overprinted
  // itself the moment a journey had one long leg and a huddle of stops at the
  // end of it — "13 4 days" and "1, 8, 14" on top of each other — and a route
  // is read by where it started and where it finished, not by labelling all of
  // it.
  const ends = React.useMemo(() => {
    const first = markers[0];
    const last = markers[markers.length - 1];
    return first && last && first !== last ? { first, last } : null;
  }, [markers]);

  if (stops.length === 0) return null;

  const places = trip.places.slice(0, 4).join(" → ");

  return (
    <figure className={styles.figure}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        role="img"
        aria-label={
          places
            ? `The route of this trip: ${places}${trip.places.length > 4 ? " and on" : ""}`
            : "The route of this trip"
        }
      >
        {stops.length > 1 ? <path className={styles.line} d={route.path} fill="none" /> : null}

        {markers.map((marker) => {
          const point = route.project(marker);
          const isActive = Boolean(activeDate && marker.dates.includes(activeDate));
          return (
            <g key={marker.key} className={isActive ? styles.stopActive : styles.stop}>
              <circle cx={point.x} cy={point.y} r={isActive ? 7 : 5} className={styles.dot} />
              {ends && (marker === ends.first || marker === ends.last) ? (
                <text
                  x={point.x}
                  y={point.y - 11}
                  className={styles.label}
                  textAnchor={point.x > VIEW_WIDTH / 2 ? "end" : "start"}
                >
                  {marker === ends.first ? "start" : "end"}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <figcaption className={styles.caption}>
        {stops.length.toLocaleString("en")} located{" "}
        {stops.length === 1 ? "photograph" : "photographs"}
        {trip.totalKm && trip.totalKm >= 1
          ? ` · ${Math.round(trip.totalKm).toLocaleString("en")} km`
          : ""}
      </figcaption>
    </figure>
  );
};

export default TripRoutePath;
