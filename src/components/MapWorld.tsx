import React from "react";
import styles from "./MapWorld.module.css";
import { OptimisedPhoto } from "../services/types";
import Link from "next/link";
import { getRelativeTimeString } from "../util/time";
import Map, { Marker, Popup } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

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

  const sortedByDate = props.photos
    .filter((p) => p.date)
    .sort((a, b) => new Date(b.date).valueOf() - new Date(a.date).valueOf());
  const oldest = sortedByDate.at(0);
  const newest = sortedByDate.at(-1);
  const range =
    new Date(newest?.date ?? 0).valueOf() -
    new Date(oldest?.date ?? 0).valueOf();

  const [clickInfo, setClickInfo] = React.useState<MapWorldEntry | null>(null);
  const [hoverInfo, setHoverInfo] = React.useState<MapWorldEntry | null>(null);
  const popupInfo = clickInfo ?? hoverInfo;

  return (
    <div className={props.className}>
      <Map
        style={{ width: "100vw", height: "100vh" }}
        mapStyle="https://api.maptiler.com/maps/streets/style.json?key=rIHHWldVP0SFPxQ7N0Ua"
      >
        {popupInfo && popupInfo.decLat && popupInfo.decLng ? (
          <Popup
            longitude={popupInfo.decLng}
            latitude={popupInfo.decLat}
            onClose={() => {
              setClickInfo(null);
            }}
            className={styles.popup}
            offset={15}
            style={{ pointerEvents: clickInfo ? "unset" : "none" }}
          >
            <>
              <Link href={popupInfo.href ?? ""} className={styles.link}>
                <img src={popupInfo.src.src} className={styles.image} />
                <div className={styles.details}>
                  {popupInfo.album}
                  <br />
                  <span>
                    {new Date(popupInfo.date).toLocaleString()}
                    <br />
                    {getRelativeTimeString(new Date(popupInfo.date))}
                  </span>
                </div>
              </Link>

              {clickInfo ? (
                <div className={styles.viewOn}>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${popupInfo.decLat}&mlon=${popupInfo.decLng}&zoom=13`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    OpenStreetMaps
                  </a>
                  &nbsp;&middot;&nbsp;
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${popupInfo.decLat},${popupInfo.decLng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google Maps
                  </a>
                </div>
              ) : null}
            </>
          </Popup>
        ) : null}

        {props.photos.map((photo) => {
          const relative =
            (new Date(photo.date ?? oldest?.date).valueOf() -
              new Date(oldest?.date ?? 0).valueOf()) /
            range;

          return photo.decLat && photo.decLng ? (
            <React.Fragment key={photo?.src?.src ?? ""}>
              <Marker
                longitude={photo.decLng}
                latitude={photo.decLat}
                anchor="bottom"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setClickInfo(photo);
                }}
                color={`hsl(${relative * 220}, 100%, ${50 - relative * 30}%)`}
              >
                <div
                  style={{ filter: `hue-rotate(${relative * 255}deg)` }}
                  className={styles.pin}
                  onMouseOver={() => {
                    setHoverInfo(photo);
                  }}
                  onMouseOut={() => {
                    setHoverInfo(null);
                  }}
                >
                  🔴
                </div>
              </Marker>
            </React.Fragment>
          ) : null;
        })}
      </Map>
    </div>
  );
};

export default MMap;
