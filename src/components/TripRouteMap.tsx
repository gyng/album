import React from "react";
import type { Trip } from "../util/computeTrips";
import { DataLayer, type LineFeature, MapView, Marker } from "./map";
import { MapLibreStyles } from "./MapLibreStyles";
import { clusterStops, routeStops } from "./tripRoute";
import { isPitchedMapStyle, mapStyleUrl } from "../util/mapStyles";
import { useMapStyleName } from "./MapStyleToggle";
import styles from "./TripRouteMap.module.css";

/** Room for a marker's picture, which stands above its pin. */
const FIT_PADDING = { top: 84, right: 40, bottom: 32, left: 40 };
const FIT_MAX_ZOOM = 12;
/** A trip that never left one place still needs a readable frame. */
const SINGLE_STOP_ZOOM = 12;
/** Enough tilt to stand the buildings up without losing the plan view. */
const PITCH = 45;

export type TripRouteMapProps = {
  trip: Trip;
  activeDate?: string | null;
};

/**
 * Frames the whole journey once the map is up.
 *
 * From `onLoad` rather than a child effect: a child mounts as soon as the map
 * object exists, which is before the style and canvas are, and a fit requested
 * then is dropped — the route opened on the whole world.
 */
const fitToStops = (
  map: { fitBounds: Function; jumpTo: Function },
  stops: ReturnType<typeof routeStops>,
  pitch?: number,
) => {
  const first = stops[0];
  if (!first) return;

  if (stops.length === 1) {
    map.jumpTo({
      center: { lng: first.lng, lat: first.lat },
      zoom: SINGLE_STOP_ZOOM,
      ...(pitch !== undefined ? { pitch } : {}),
    });
    return;
  }

  const lats = stops.map((stop) => stop.lat);
  const lngs = stops.map((stop) => stop.lng);
  map.fitBounds(
    [
      { lng: Math.min(...lngs), lat: Math.min(...lats) },
      { lng: Math.max(...lngs), lat: Math.max(...lats) },
    ],
    { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, ...(pitch !== undefined ? { pitch } : {}) },
  );
};

/** The day's photograph, standing above its pin, faded in once it has decoded. */
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
 * A trip's route over a basemap.
 *
 * The basemap is OpenFreeMap: keyless and unmetered, which is what makes a map
 * per trip affordable on a page that lists ninety-four of them. The metered
 * provider is kept for what the free one has no answer to — imagery, terrain
 * and this fork's own design — so a rate limit there cannot take these down.
 */
export const TripRouteMap = ({ trip, activeDate }: TripRouteMapProps) => {
  const styleName = useMapStyleName();
  const stops = React.useMemo(() => routeStops(trip), [trip]);
  const markers = React.useMemo(() => clusterStops(stops), [stops]);

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

  if (stops.length === 0) return null;

  return (
    <div className={styles.map}>
      {/* Without MapLibre's own stylesheet the canvas mounts, reports itself
          ready and draws nothing at all. */}
      <MapLibreStyles />
      <MapView
        styleUrl={mapStyleUrl(styleName)}
        attribution={{ compact: true, collapsed: true }}
        initialView={isPitchedMapStyle(styleName) ? { pitch: PITCH } : {}}
        onLoad={(map) =>
          fitToStops(map as never, stops, isPitchedMapStyle(styleName) ? PITCH : undefined)
        }
      >
        <DataLayer id={`trip-route-${trip.id}`} lines={lines} order={1} />
        {markers.map((marker) => {
          const isActive = Boolean(activeDate && marker.dates.includes(activeDate));
          return (
            <Marker
              key={marker.key}
              at={{ lng: marker.lng, lat: marker.lat }}
              anchor="bottom"
              // Markers on a narrow map overlap; the one being pointed at comes
              // out from under its neighbours.
              style={{ zIndex: isActive ? 2 : 1 }}
            >
              <span className={styles.pin} data-active={isActive}>
                {marker.src ? <StopImage src={marker.src} /> : null}
              </span>
            </Marker>
          );
        })}
      </MapView>
    </div>
  );
};

export default TripRouteMap;
