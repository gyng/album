import React from "react";
import type { Trip } from "../util/computeTrips";
import { DataLayer, type LineFeature, MapView, Marker } from "./map";
import { fitToRoute, routeStops } from "./tripRoute";
import { MapLibreStyles } from "./MapLibreStyles";
import pinStyles from "./mapPin.module.css";
import { useMapStyleName } from "./MapStyleToggle";
import { mapStyleUrl } from "../util/mapStyles";
import styles from "./TripRouteMap.module.css";

/**
 * A day's photograph, standing above its pin.
 *
 * The fade waits for the picture rather than starting at mount, and a cached
 * image that finished before React was listening is caught by the ref — the
 * same two rules the world map's markers follow.
 */
const StopImage = ({ src }: { src: string }) => {
  const [isLoaded, setIsLoaded] = React.useState(false);
  const imageRef = React.useCallback((element: HTMLImageElement | null) => {
    if (element?.complete && element.naturalWidth > 0) setIsLoaded(true);
  }, []);

  return (
    <img
      ref={imageRef}
      src={src}
      className={styles.thumb}
      data-loaded={isLoaded}
      loading="lazy"
      alt=""
      aria-hidden="true"
      onLoad={() => setIsLoaded(true)}
    />
  );
};

/**
 * A trip's route: the line it travelled, with one photograph per day numbered
 * along it.
 *
 * Deliberately not `MapWorld`'s behaviour. That gates thumbnails on zoom
 * because it draws the whole archive, and a trip opens fitted to its entire
 * extent — inheriting it would show a journey as a handful of dots. One frame
 * per day is the point: it is what makes the line a story rather than a shape.
 */
export type TripRouteMapProps = { trip: Trip };

export const TripRouteMap = ({ trip }: TripRouteMapProps) => {
  const styleName = useMapStyleName();
  const stops = React.useMemo(() => routeStops(trip), [trip]);

  const lines = React.useMemo<LineFeature[]>(
    () =>
      stops.length < 2
        ? []
        : [
            {
              id: `trip-${trip.id}`,
              path: stops.map((stop) => ({ lng: stop.lng, lat: stop.lat })),
              color: "#e4572e",
              width: 2,
              opacity: 0.85,
            },
          ],
    [stops, trip.id],
  );

  if (stops.length === 0) {
    return (
      <p className={styles.empty}>
        No photograph on this trip recorded where it was taken, so there is no route to draw.
      </p>
    );
  }

  return (
    // Sized by its wrapper, as Map.tsx does — the port takes no class name.
    <div className={styles.map}>
      {/* Without MapLibre's own stylesheet the canvas renders, reports itself
          ready, and draws nothing. Every other map on this site loads it. */}
      <MapLibreStyles />
      <MapView
        styleUrl={mapStyleUrl(styleName)}
        attribution={{ compact: true, collapsed: true }}
        onLoad={(map) => fitToRoute(map, stops)}
      >
        <DataLayer id={`trip-route-${trip.id}`} lines={lines} order={1} />
        {stops.map((stop) => (
          <Marker key={stop.date} at={{ lng: stop.lng, lat: stop.lat }} anchor="bottom">
            {/* The same shape every other map on this site uses: a pin on the
                point, its picture standing above it. */}
            <span className={pinStyles.pin} style={{ color: "var(--c-accent)" }}>
              {stop.src ? <StopImage src={stop.src} /> : null}
              <span className={styles.number}>{stop.number}</span>
            </span>
          </Marker>
        ))}
      </MapView>
    </div>
  );
};

export default TripRouteMap;
