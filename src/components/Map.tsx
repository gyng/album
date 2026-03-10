import { CSSProperties, useEffect } from "react";
import React from "react";
import styles from "./Map.module.css";

import Map, { Marker, useMap } from "react-map-gl/maplibre";
import type { ProjectionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";

type OpenFreeMapStyle = "positron" | "bright" | "liberty";

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
  coordinates: [number, number];
  style?: CSSProperties;
  attribution?: boolean;
  details?: boolean;
  mapStyle?: MapTilerMapStyle;
  markerStyle?: CSSProperties;
  projection?: "vertical-perspective" | "mercator";
};

const ZOOM = 12;

const MapFlyer = (props: { coordinates: [number, number] }) => {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map || !props.coordinates) {
      return;
    }

    map.flyTo({
      center: [props.coordinates[1], props.coordinates[0]],
      zoom: ZOOM,
      speed: 2.4,
    });
  }, [props.coordinates, map]);

  return <></>;
};

export const MMap: React.FC<MapProps> = (props) => {
  const mapStyle: MapTilerMapStyle = props.mapStyle ?? "streets";
  const projection = props.projection ?? "mercator";
  const projectionSpec: "mercator" | "globe" | ProjectionSpecification =
    projection === "vertical-perspective"
      ? ({ name: "vertical-perspective" } as ProjectionSpecification)
      : projection;

  return (
    <div className={styles.map}>
      <Map
        style={{ width: "100%", height: "100%", ...(props.style ?? {}) }}
        // mapStyle="https://tiles.openfreemap.org/styles/liberty"
        mapStyle={`https://api.maptiler.com/maps/${mapStyle}/style.json?key=mrjUpLh9Syjz9wcEY2Vb`}
        initialViewState={{
          longitude: props.coordinates[1],
          latitude: props.coordinates[0],
          zoom: ZOOM,
        }}
        projection={projectionSpec}
        attributionControl={
          props.attribution === false ? false : { compact: true }
        }
      >
        <Marker
          longitude={props.coordinates[1]}
          latitude={props.coordinates[0]}
          anchor="bottom"
          color="var(--c-accent)"
          style={props.markerStyle ?? {}}
        />
        <MapFlyer coordinates={props.coordinates} />
      </Map>

      {props.details !== false ? (
        <div className={styles.viewOn}>
          View on{" "}
          <Link
            href={`http://localhost:3000/map?lat=${props.coordinates[0].toPrecision(6)}&lon=${props.coordinates[1].toPrecision(6)}&zoom=14`}
          >
            Album map
          </Link>
          &nbsp;&middot;&nbsp;
          <a
            href={`https://www.openstreetmap.org/?mlat=${props.coordinates[0]}&mlon=${props.coordinates[1]}&zoom=14`}
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap
          </a>
          &nbsp;&middot;&nbsp;
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${props.coordinates[0]},${props.coordinates[1]}`}
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
