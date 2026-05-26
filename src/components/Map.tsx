import { CSSProperties, useEffect } from "react";
import React from "react";
import styles from "./Map.module.css";
import pinStyles from "./mapPin.module.css";

import Map, { Marker, useMap } from "react-map-gl/maplibre";
import type { ProjectionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";

type MapTilerMapStyle =
  | "aquarelle"
  | "bright"
  | "backdrop"
  | "basic"
  | "toner-v2"
  | "streets"
  | "dataviz"
  | "landscape"
  | "ocean"
  | "openstreetmap"
  | "outdoor"
  | "satellite"
  | "topo"
  | "winter";

export type MapProps = {
  // Single coord (legacy) or an array (e.g. remix slides plotting all photos
  // in the layout). With an array the map fitBounds() onto the enclosing
  // rectangle plus a small zoom-out padding; with a single coord it flyTo()s
  // at the existing fixed zoom.
  coordinates: [number, number] | [number, number][];
  style?: CSSProperties;
  attribution?: boolean;
  details?: boolean;
  mapStyle?: MapTilerMapStyle;
  markerStyle?: CSSProperties;
  projection?: "vertical-perspective" | "mercator";
};

const ZOOM = 12;
const FIT_BOUNDS_PADDING_PX = 48;
const FIT_BOUNDS_MAX_ZOOM = 11;

const normaliseCoords = (
  input: [number, number] | [number, number][],
): [number, number][] => {
  if (input.length === 0) return [];
  // A tuple is just `[number, number]` — guard by checking if the first item
  // is itself an array.
  if (Array.isArray((input as unknown[])[0])) {
    return input as [number, number][];
  }
  return [input as [number, number]];
};

const MapFlyer = (props: { coordinates: [number, number][] }) => {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map || props.coordinates.length === 0) {
      return;
    }

    if (props.coordinates.length === 1) {
      const [lat, lng] = props.coordinates[0];
      map.flyTo({
        center: [lng, lat],
        zoom: ZOOM,
        speed: 2.4,
      });
      return;
    }

    // Multiple points — fit bounds with padding so all markers are framed
    // with a small margin around them.
    const lngs = props.coordinates.map(([, lng]) => lng);
    const lats = props.coordinates.map(([lat]) => lat);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: FIT_BOUNDS_PADDING_PX, maxZoom: FIT_BOUNDS_MAX_ZOOM, duration: 800 },
    );
  }, [props.coordinates, map]);

  return <></>;
};

export const MMap: React.FC<MapProps> = (props) => {
  const mapStyle: MapTilerMapStyle = props.mapStyle ?? "streets";
  const projection = props.projection ?? "mercator";
  const projectionSpec: "mercator" | "globe" | ProjectionSpecification =
    projection === "vertical-perspective"
      ? { type: "vertical-perspective" }
      : projection;

  const coords = normaliseCoords(props.coordinates);
  // First coord doubles as the initial centre + the "view on" deep-link
  // anchor. Centroid would be more honest for multi-point but rarely useful
  // to deep-link to.
  const primary = coords[0] ?? ([0, 0] as [number, number]);

  return (
    <div className={styles.map}>
      <Map
        style={{ width: "100%", height: "100%", ...(props.style ?? {}) }}
        // mapStyle="https://tiles.openfreemap.org/styles/liberty"
        mapStyle={`https://api.maptiler.com/maps/${mapStyle}/style.json?key=mrjUpLh9Syjz9wcEY2Vb`}
        initialViewState={{
          longitude: primary[1],
          latitude: primary[0],
          zoom: ZOOM,
        }}
        projection={projectionSpec}
        attributionControl={
          props.attribution === false ? false : { compact: true }
        }
      >
        {coords.map(([lat, lng], idx) => (
          <Marker
            key={`${lat}-${lng}-${idx}`}
            longitude={lng}
            latitude={lat}
            anchor="center"
            style={props.markerStyle ?? {}}
          >
            <span
              className={pinStyles.pin}
              style={{ color: "var(--c-accent)" }}
            />
          </Marker>
        ))}
        <MapFlyer coordinates={coords} />
      </Map>

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
  );
};

export default MMap;
