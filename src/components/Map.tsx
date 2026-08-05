import { CSSProperties, useEffect } from "react";
import React from "react";
import styles from "./Map.module.css";
import pinStyles from "./mapPin.module.css";

import { type Bounds, MapView, Marker, useMap } from "./map";
import { AppLink as Link } from "./platform";
import { computeWrapAwareBounds } from "../util/mapBounds";
import { type MapStyleName, mapStyleUrl, themeMapStyle } from "../util/mapStyles";
import { useActiveTheme } from "./useActiveTheme";
import { MapLibreStyles } from "./MapLibreStyles";

export type MapProps = {
  // Single coord (legacy) or an array (e.g. remix slides plotting all photos
  // in the layout). With an array the map fitBounds() onto the enclosing
  // rectangle plus a small zoom-out padding; with a single coord it flyTo()s
  // at the existing fixed zoom.
  coordinates: [number, number] | [number, number][];
  style?: CSSProperties;
  attribution?: boolean;
  details?: boolean;
  /**
   * One of the site's own basemap names rather than a provider style id, so
   * these small maps follow the same free-where-possible split as the big ones:
   * a photograph's location map used to name a metered style directly and was
   * the last thing on an ordinary page view that could be rate-limited away.
   */
  mapStyle?: MapStyleName;
  markerStyle?: CSSProperties;
  projection?: "vertical-perspective" | "mercator";
};

const ZOOM = 12;
const FIT_BOUNDS_PADDING_PX = 48;
const FIT_BOUNDS_MAX_ZOOM = 11;

const normaliseCoords = (input: [number, number] | [number, number][]): [number, number][] => {
  if (input.length === 0) return [];
  // A tuple is just `[number, number]` — guard by checking if the first item
  // is itself an array.
  if (Array.isArray((input as unknown[])[0])) {
    return input as [number, number][];
  }
  return [input as [number, number]];
};

const MapFlyer = (props: { coordinates: [number, number][] }) => {
  const map = useMap();
  useEffect(() => {
    if (!map || props.coordinates.length === 0) {
      return;
    }

    if (props.coordinates.length === 1) {
      const first = props.coordinates[0];
      if (!first) {
        return;
      }
      const [lat, lng] = first;
      map.flyTo({
        center: { lng, lat },
        zoom: ZOOM,
        speed: 2.4,
      });
      return;
    }

    // Multiple points — fit bounds with padding so all markers are framed
    // with a small margin around them. coordinates are [lat, lng]; the bounds
    // helper wants [lng, lat] and returns antimeridian-aware corners so a
    // layout spanning ±180° doesn't frame the whole globe.
    const [[west, south], [east, north]] = computeWrapAwareBounds(
      props.coordinates.map(([lat, lng]) => [lng, lat] as [number, number]),
    )!;
    const bounds: Bounds = [
      { lng: west, lat: south },
      { lng: east, lat: north },
    ];

    map.fitBounds(bounds, {
      padding: FIT_BOUNDS_PADDING_PX,
      maxZoom: FIT_BOUNDS_MAX_ZOOM,
      duration: 800,
    });
  }, [props.coordinates, map]);

  return <></>;
};

const MMapComponent: React.FC<MapProps> = (props) => {
  const theme = useActiveTheme();
  // A theme with a map of its own is wearing it everywhere, not only on the
  // map page: a photograph shown under the terminal theme should not carry a
  // street map in the middle of a green screen. A caller that names a style
  // means it, and light and dark keep this map's own deliberate choice.
  const mapStyle: MapStyleName = props.mapStyle ?? themeMapStyle(theme) ?? "streets";
  const projection = props.projection ?? "mercator";

  const coords = normaliseCoords(props.coordinates);
  // First coord doubles as the initial centre + the "view on" deep-link
  // anchor. Centroid would be more honest for multi-point but rarely useful
  // to deep-link to.
  const primary = coords[0] ?? ([0, 0] as [number, number]);
  const markerStyle = {
    color: "var(--c-accent)",
    ...props.markerStyle,
  };

  return (
    <>
      <MapLibreStyles />
      <div className={styles.map}>
        <MapView
          {...(props.style !== undefined ? { style: props.style } : {})}
          styleUrl={mapStyleUrl(mapStyle, theme)}
          initialView={{
            center: { lng: primary[1], lat: primary[0] },
            zoom: ZOOM,
          }}
          projection={projection}
          attribution={props.attribution === false ? false : { compact: true }}
        >
          {coords.map(([lat, lng], idx) => (
            <Marker
              key={`${lat}-${lng}-${idx}`}
              at={{ lng, lat }}
              anchor="center"
              style={markerStyle}
            >
              <span data-map-pin className={pinStyles.pin} />
            </Marker>
          ))}
          <MapFlyer coordinates={coords} />
        </MapView>

        {props.details !== false ? (
          <div className={styles.viewOn}>
            View on{" "}
            <Link
              href={`/map?lat=${primary[0].toPrecision(6)}&lon=${primary[1].toPrecision(6)}&zoom=14`}
            >
              Album map
            </Link>
            &nbsp;&middot;&nbsp;
            <a
              href={`https://www.openstreetmap.org/?mlat=${primary[0]}&mlon=${primary[1]}&zoom=14`}
              target="_blank"
              rel="noreferrer"
            >
              OpenStreetMap
            </a>
            &nbsp;&middot;&nbsp;
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${primary[0]},${primary[1]}`}
              target="_blank"
              rel="noreferrer"
            >
              Google Maps
            </a>
          </div>
        ) : null}
      </div>
    </>
  );
};

// Memoised so parents that re-render with referentially-stable props (e.g. the
// slideshow's per-second clock tick) don't re-run the WebGL map needlessly.
// With changed props it renders as normal.
export const MMap = React.memo(MMapComponent);

export default MMap;
