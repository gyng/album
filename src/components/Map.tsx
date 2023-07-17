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

  const pinSvg = `<svg xmlns="http://www.w3.org/2000/svg" enable-background="new 0 0 32 32" height="32" viewBox="0 0 32 32" width="32"><g><path d="M12,2c-4.2,0-8,3.22-8,8.2c0,3.32,2.67,7.25,8,11.8c5.33-4.55,8-8.48,8-11.8C20,5.22,16.2,2,12,2z M12,12c-1.1,0-2-0.9-2-2 c0-1.1,0.9-2,2-2c1.1,0,2,0.9,2,2C14,11.1,13.1,12,12,12z"/></g></svg>`;

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
            html: pinSvg,
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
