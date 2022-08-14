import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { CSSProperties } from "react";
import React from "react";
import Leaflet from "leaflet";
import styles from "./Map.module.css";

export type MapProps = {
  coordinates: [number, number];
  style?: CSSProperties;
};

const resizeMap = (mapRef: React.RefObject<typeof MMap>) => {
  // @ts-expect-error
  mapRef.current?.invalidateSize();
  const timer = window.setInterval(() => {
    // @ts-expect-error
    if (mapRef.current?.invalidateSize) {
      // @ts-expect-error
      mapRef.current?.invalidateSize();
    }
  }, 100);
  return timer;
};

export const MMap: React.FC<MapProps> = (props) => {
  const mapRef = React.useRef(null);

  // react-leaflet doesn't show the map correctly. Force it to keep invalidating size to load tiles.
  React.useEffect(() => {
    const timer = resizeMap(mapRef);
    return () => {
      window.clearInterval(timer);
    };
  }, [mapRef]);

  return (
    <div
      style={{
        height: 300,
        width: 300,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <MapContainer
        ref={mapRef}
        center={props.coordinates}
        zoom={13}
        scrollWheelZoom={false}
        style={props.style ?? { flex: 1 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker
          position={props.coordinates}
          icon={Leaflet.divIcon({
            iconSize: [32, 32],
            iconAnchor: [32, 32],
            className: styles.marker,
            html: "📍",
          })}
        />
      </MapContainer>
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
