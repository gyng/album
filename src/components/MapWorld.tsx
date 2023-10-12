import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import React from "react";
import Leaflet from "leaflet";
import styles from "./MapWorld.module.css";
import { OptimisedPhoto } from "../services/types";
import Link from "next/link";
import { getRelativeTimeString } from "../util/time";

export type MapWorldEntry = {
  album: string;
  src: OptimisedPhoto;
  decLat: number | null;
  decLng: number | null;
  date: string;
  href: string;
};

export type MapWorldProps = {
  photos: MapWorldEntry[];
  className: string;
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

export const MMap: React.FC<MapWorldProps> = (props) => {
  const mapRef = React.useRef(null);

  // react-leaflet doesn't show the map correctly. Force it to keep invalidating size to load tiles.
  React.useEffect(() => {
    const timer = resizeMap(mapRef);
    return () => {
      window.clearInterval(timer);
    };
  }, [mapRef]);

  const pinSvg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      enable-background="new 0 0 32 32"
      height="32"
      viewBox="0 0 32 32"
      width="32"
    >
      <g>
        <path fill="hsl(0, 0, 0)" d="M12,2c-4.2,0-8,3.22-8,8.2c0,3.32,2.67,7.25,8,11.8c5.33-4.55,8-8.48,8-11.8C20,5.22,16.2,2,12,2z M12,12c-1.1,0-2-0.9-2-2 c0-1.1,0.9-2,2-2c1.1,0,2,0.9,2,2C14,11.1,13.1,12,12,12z" />
      </g>
    </svg>
  `;

  const sortedByDate = props.photos
    .filter((p) => p.date)
    .sort((a, b) => new Date(b.date).valueOf() - new Date(a.date).valueOf());
  const oldest = sortedByDate.at(0);
  const newest = sortedByDate.at(-1);
  const range =
    new Date(newest?.date ?? 0).valueOf() -
    new Date(oldest?.date ?? 0).valueOf();

  const meanLat =
    props.photos.reduce((acc, val) => acc + (val?.decLat ?? 0), 0) /
    props.photos.length;
  const meanLng =
    props.photos.reduce((acc, val) => acc + (val?.decLng ?? 0), 0) /
    props.photos.length;

  return (
    <div className={props.className}>
      <MapContainer
        ref={mapRef}
        center={[meanLat, meanLng]}
        zoom={2}
        scrollWheelZoom
        style={{ flex: 1 }}
      >
        {/* Use Next.js rewrites to hit OSM maps. This is needed because of COEP headers installed for WASM/search blocks maps loaded from OSM. */}
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
          url="/osm/{s}/{z}/{x}/{y}"
        />
        {props.photos.map((photo) => {
          const relative =
            (new Date(photo.date ?? oldest?.date).valueOf() -
              new Date(oldest?.date ?? 0).valueOf()) /
            range;

          return photo.decLat && photo.decLng ? (
            <Marker
              position={[photo.decLat, photo.decLng]}
              icon={Leaflet.divIcon({
                iconSize: [16, 20],
                iconAnchor: [10, 16],
                className: styles.marker,
                html: pinSvg.replace(
                  "hsl(0, 0, 0)",
                  `hsl(${relative * 220}, 100%, ${50 - relative * 30}%)`
                ),
              })}
            >
              <Popup>
                <Link href={photo.href ?? ""} className={styles.link}>
                  <img src={photo.src.src} className={styles.image} />
                  <div className={styles.details}>
                    {photo.album}
                    <br />
                    <span>
                      {new Date(photo.date).toLocaleString()}
                      <br />
                      {getRelativeTimeString(new Date(photo.date))}
                    </span>
                  </div>
                </Link>
              </Popup>
            </Marker>
          ) : null;
        })}
      </MapContainer>
    </div>
  );
};

export default MMap;
