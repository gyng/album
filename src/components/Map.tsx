import { CSSProperties } from "react";
import React from "react";
import styles from "./Map.module.css";

import Map, { Marker } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";

export type MapProps = {
  coordinates: [number, number];
  style?: CSSProperties;
};

export const MMap: React.FC<MapProps> = (props) => {
  return (
    <div className={styles.map}>
      <Map
        style={{ width: "100%", height: "100%" }}
        // mapStyle="https://tiles.openfreemap.org/styles/liberty"
        mapStyle="https://api.maptiler.com/maps/streets/style.json?key=rIHHWldVP0SFPxQ7N0Ua"
        initialViewState={{
          longitude: props.coordinates[1],
          latitude: props.coordinates[0],
          zoom: 12,
        }}
      >
        <Marker
          longitude={props.coordinates[1]}
          latitude={props.coordinates[0]}
          anchor="bottom"
          color="var(--c-accent)"
        />
      </Map>

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
    </div>
  );
};

export default MMap;
