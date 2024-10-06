import { CSSProperties } from "react";
import React from "react";
import styles from "./Map.module.css";

import Map, { Marker } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

export type MapProps = {
  coordinates: [number, number];
  style?: CSSProperties;
};

export const MMap: React.FC<MapProps> = (props) => {
  return (
    <div className={styles.map}>
      <Map
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://api.maptiler.com/maps/streets/style.json?key=rIHHWldVP0SFPxQ7N0Ua"
        initialViewState={{
          longitude: props.coordinates[1],
          latitude: props.coordinates[0],
          zoom: 12,
        }}
        RTLTextPlugin={false}
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
        <a
          href={`https://www.openstreetmap.org/?mlat=${props.coordinates[0]}&mlon=${props.coordinates[1]}&zoom=13`}
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMaps
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
