import React, { useEffect, useRef } from "react";
import styles from "./MapWorld.module.css";
import { OptimisedPhoto } from "../services/types";
import Link from "next/link";
import { getRelativeTimeString } from "../util/time";
import Map, { Marker, Popup } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useIntersectionObserver } from "usehooks-ts";
import { useRouter } from "next/router";

export type MapWorldEntry = {
  album: string;
  src: OptimisedPhoto;
  decLat: number | null;
  decLng: number | null;
  date: string;
  href: string;
  placeholderColor?: string;
  placeholderWidth?: number;
  placeholderHeight?: number;
};

export type MapWorldProps = {
  photos: MapWorldEntry[];
  className: string;
};

const LazyImage = (props: { photo: MapWorldEntry }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const entry = useIntersectionObserver(ref, {
    rootMargin: "100px",
  });
  const isVisible = !!entry?.isIntersecting;

  return (
    <div ref={ref}>
      {isVisible && (
        <img
          src={props.photo.src.src}
          className={styles.photoMarkerImage}
          width={props.photo.placeholderWidth}
          height={props.photo.placeholderHeight}
          style={{
            backgroundColor: `${props.photo.placeholderColor}`,
          }}
          loading="lazy"
          alt=""
        />
      )}
    </div>
  );
};

export const MMap: React.FC<MapWorldProps> = (props) => {
  const [zoom, setZoom] = React.useState<number | null>(null);
  const router = useRouter();

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

  const url = new URL(window.location.toString());
  const initialLon = url.searchParams.get("lon");
  const initialLat = url.searchParams.get("lat");
  const initialZoom = url.searchParams.get("zoom");

  return (
    <div className={props.className}>
      <Map
        style={{ width: "100vw", height: "100vh" }}
        mapStyle="https://api.maptiler.com/maps/ffd8bd10-cd97-40a5-b1d6-d15f98fb3644/style.json?key=iilC4hPY1594noPX9OQ2"
        initialViewState={{
          longitude: initialLon ? Number.parseFloat(initialLon) : undefined,
          latitude: initialLat ? Number.parseFloat(initialLat) : undefined,
          zoom: initialZoom ? Number.parseFloat(initialZoom) : undefined,
        }}
        onZoom={(e) => {
          setZoom(e.viewState.zoom);
        }}
        onZoomEnd={(e) => {
          const zoom = e.viewState.zoom;
          const lat = e.viewState.latitude;
          const lng = e.viewState.longitude;
          const url = new URL(window.location.toString());
          const searchParams = new URLSearchParams(window.location.search);
          searchParams.set("lat", lat.toPrecision(6).toString());
          searchParams.set("lon", lng.toPrecision(6).toString());
          searchParams.set("zoom", zoom.toPrecision(4).toString());
          url.search = searchParams.toString();
          router.replace(url, undefined, { shallow: true });
        }}
      >
        {popupInfo && popupInfo.decLat && popupInfo.decLng ? (
          <Popup
            longitude={popupInfo.decLng}
            latitude={popupInfo.decLat}
            onClose={() => {
              setClickInfo(null);
            }}
            className={`${styles.popup} ${
              clickInfo ? styles.click : styles.hover
            }`}
            offset={15}
            closeButton={false}
          >
            <>
              <Link href={popupInfo.href ?? ""} className={styles.link}>
                <img
                  src={popupInfo.src.src}
                  className={styles.image}
                  width={popupInfo.placeholderWidth}
                  height={popupInfo.placeholderHeight}
                  style={{ backgroundColor: popupInfo.placeholderColor }}
                />
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
                <div>
                  {zoom && zoom > 8.5 ? <LazyImage photo={photo} /> : null}
                  <span
                    style={{ filter: `hue-rotate(${relative * 255}deg)` }}
                    className={styles.pin}
                    onMouseOver={() => {
                      setHoverInfo(photo);
                    }}
                    onMouseLeave={() => {
                      setHoverInfo(null);
                    }}
                  >
                    🔴
                  </span>
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
