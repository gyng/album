import React from "react";
import styles from "./MapWorld.module.css";
import { OptimisedPhoto } from "../services/types";
import Link from "next/link";
import { getRelativeTimeString } from "../util/time";
import Map, {
  Marker,
  Popup,
  ScaleControl,
  NavigationControl,
  GeolocateControl,
  FullscreenControl,
  ViewStateChangeEvent,
  useMap,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useIntersectionObserver } from "usehooks-ts";
import { ThemeToggle } from "./ThemeToggle";

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
  style?: React.CSSProperties;
  syncRoute?: boolean;
  fitToPhotos?: boolean;
  showThemeBootstrap?: boolean;
};

const MapAutoFit = ({
  enabled,
  photos,
}: {
  enabled: boolean;
  photos: MapWorldEntry[];
}) => {
  const { current: map } = useMap();

  React.useEffect(() => {
    if (!enabled || !map) {
      return;
    }

    const coordinates = photos
      .filter((photo) => photo.decLat !== null && photo.decLng !== null)
      .map((photo) => [photo.decLng as number, photo.decLat as number] as [number, number]);

    if (coordinates.length === 0) {
      return;
    }

    if (coordinates.length === 1) {
      const [longitude, latitude] = coordinates[0];
      map.flyTo({ center: [longitude, latitude], zoom: 10.5, speed: 2.2 });
      return;
    }

    const longitudes = coordinates.map(([longitude]) => longitude);
    const latitudes = coordinates.map(([, latitude]) => latitude);

    map.fitBounds(
      [
        [Math.min(...longitudes), Math.min(...latitudes)],
        [Math.max(...longitudes), Math.max(...latitudes)],
      ],
      {
        padding: 36,
        duration: 0,
        maxZoom: 11,
      },
    );
  }, [enabled, map, photos]);

  return null;
};

const LazyImage = ({ photo }: { photo: MapWorldEntry }) => {
  const { entry, ref } = useIntersectionObserver({ rootMargin: "100px" });
  const isVisible = !!entry?.isIntersecting;

  return (
    <div ref={ref}>
      {isVisible && (
        <img
          src={photo.src.src}
          className={styles.photoMarkerImage}
          width={photo.placeholderWidth}
          height={photo.placeholderHeight}
          style={{
            backgroundColor: `${photo.placeholderColor}`,
          }}
          loading="lazy"
          alt=""
        />
      )}
    </div>
  );
};

// Component to track map bounds for viewport culling
const MapBoundsTracker = ({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }) => void;
}) => {
  const { current: map } = useMap();

  React.useEffect(() => {
    if (!map) return;

    const updateBounds = () => {
      const bounds = map.getBounds();
      if (bounds) {
        onBoundsChange({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
      }
    };

    // Set initial bounds
    updateBounds();

    // Update bounds on move
    map.on("moveend", updateBounds);
    map.on("zoomend", updateBounds);

    return () => {
      map.off("moveend", updateBounds);
      map.off("zoomend", updateBounds);
    };
  }, [map, onBoundsChange]);

  return null;
};

type PhotoWithStyle = MapWorldEntry & {
  relative: number;
  markerColor: string;
  hueRotate: string;
};

const ROUTER_SYNC_DEBOUNCE_MS = 200;
const ROUTER_SYNC_PAUSE_MS = 700;

export const MMap: React.FC<MapWorldProps> = ({
  photos,
  className,
  style,
  syncRoute = true,
  fitToPhotos = false,
  showThemeBootstrap = true,
}) => {
  const url = typeof window === "undefined" ? null : new URL(window.location.toString());
  const initialLon = syncRoute ? url?.searchParams.get("lon") ?? null : null;
  const initialLat = syncRoute ? url?.searchParams.get("lat") ?? null : null;
  const initialZoom = syncRoute ? url?.searchParams.get("zoom") ?? null : null;

  const [zoom, setZoom] = React.useState<number | null>(
    initialZoom ? Number.parseFloat(initialZoom) : null,
  );

  const [bounds, setBounds] = React.useState<{
    north: number;
    south: number;
    east: number;
    west: number;
  } | null>(null);
  // Memoize date range calculations (Optimization #1)
  const dateStats = React.useMemo(() => {
    const sortedByDate = photos
      .filter((p) => p.date)
      .sort((a, b) => new Date(b.date).valueOf() - new Date(a.date).valueOf());
    const oldest = sortedByDate.at(0);
    const newest = sortedByDate.at(-1);
    const range =
      new Date(newest?.date ?? 0).valueOf() -
      new Date(oldest?.date ?? 0).valueOf();

    return { oldest, newest, range };
  }, [photos]);

  // Memoize sorted photos with pre-calculated marker styles (Optimization #2)
  const photosWithStyles = React.useMemo(() => {
    return photos
      .sort((a, b) => {
        // sort so newer markers are on top
        return new Date(a.date).valueOf() - new Date(b.date).valueOf();
      })
      .map((photo): PhotoWithStyle => {
        const relative =
          (new Date(photo.date ?? dateStats.oldest?.date).valueOf() -
            new Date(dateStats.oldest?.date ?? 0).valueOf()) /
          dateStats.range;

        return {
          ...photo,
          relative,
          markerColor: `hsl(${relative * 220}, 100%, ${50 - relative * 30}%)`,
          hueRotate: `hue-rotate(${relative * 255}deg)`,
        };
      });
  }, [photos, dateStats]);

  // Filter photos by viewport bounds (Optimization #3)
  const visiblePhotos = React.useMemo(() => {
    if (!bounds) {
      return photosWithStyles;
    }

    return photosWithStyles.filter((photo) => {
      if (!photo.decLat || !photo.decLng) return false;

      return (
        photo.decLat >= bounds.south &&
        photo.decLat <= bounds.north &&
        photo.decLng >= bounds.west &&
        photo.decLng <= bounds.east
      );
    });
  }, [photosWithStyles, bounds]);

  const [clickInfo, setClickInfo] = React.useState<MapWorldEntry | null>(null);
  const [hoverInfo, setHoverInfo] = React.useState<MapWorldEntry | null>(null);
  const lastSyncedRouteRef = React.useRef<string>("");
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pauseUntilRef = React.useRef<number>(0);
  const popupInfo = clickInfo ?? hoverInfo;

  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const pauseRouterSync = React.useCallback(() => {
    if (!syncRoute) {
      return;
    }

    pauseUntilRef.current = Date.now() + ROUTER_SYNC_PAUSE_MS;
  }, [syncRoute]);

  const updateParams = (e: ViewStateChangeEvent) => {
    if (!syncRoute) {
      return;
    }

    const url = new URL(window.location.toString());
    const searchParams = new URLSearchParams(window.location.search);

    if (e.viewState.latitude !== 0) {
      searchParams.set("lat", e.viewState.latitude.toFixed(3).toString());
    }

    if (e.viewState.longitude !== 0) {
      searchParams.set("lon", e.viewState.longitude.toFixed(3).toString());
    }

    if (e.viewState.zoom !== 1) {
      searchParams.set("zoom", e.viewState.zoom.toFixed(2).toString());
    }

    url.search = searchParams.toString();
    const nextRoute = `${url.pathname}${url.search}${url.hash}`;
    if (nextRoute === lastSyncedRouteRef.current) {
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      if (Date.now() < pauseUntilRef.current) {
        return;
      }

      lastSyncedRouteRef.current = nextRoute;
      window.history.replaceState(window.history.state, "", nextRoute);
    }, ROUTER_SYNC_DEBOUNCE_MS);
  };

  return (
    <div className={className}>
      {showThemeBootstrap ? (
        <div style={{ position: "fixed", pointerEvents: "none", opacity: "0" }}>
          <ThemeToggle />
        </div>
      ) : null}
      <Map
        style={{ width: "100%", height: "100%", ...style }}
        // two options for map style
        // mapStyle="https://tiles.openfreemap.org/styles/liberty"
        // mapStyle="https://vector.openstreetmap.org/shortbread_v1/tilejson.json"
        mapStyle="https://api.maptiler.com/maps/ffd8bd10-cd97-40a5-b1d6-d15f98fb3644/style.json?key=iilC4hPY1594noPX9OQ2"
        initialViewState={{
          longitude: initialLon ? Number.parseFloat(initialLon) : undefined,
          latitude: initialLat ? Number.parseFloat(initialLat) : undefined,
          zoom: initialZoom ? Number.parseFloat(initialZoom) : undefined,
        }}
        onZoom={(e) => {
          setZoom(e.viewState.zoom);
        }}
        onZoomEnd={updateParams}
        onMoveEnd={updateParams}
      >
        <MapAutoFit enabled={fitToPhotos} photos={photos} />
        <MapBoundsTracker onBoundsChange={setBounds} />

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
            <div
              onMouseDownCapture={pauseRouterSync}
              onTouchStartCapture={pauseRouterSync}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <Link href={popupInfo.href ?? ""} className={styles.link}>
                <img
                  src={popupInfo.src.src}
                  className={styles.image}
                  width={popupInfo.placeholderWidth}
                  height={popupInfo.placeholderHeight}
                  style={{ backgroundColor: popupInfo.placeholderColor }}
                  alt=""
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
            </div>
          </Popup>
        ) : null}

        {visiblePhotos.map((photo) => {
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
                color={photo.markerColor}
              >
                <div>
                  {zoom && zoom > 8.5 ? <LazyImage photo={photo} /> : null}
                  <span
                    style={{ filter: photo.hueRotate }}
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

        <NavigationControl />
        <GeolocateControl />
        <ScaleControl />
        <FullscreenControl />
      </Map>
    </div>
  );
};

export default MMap;
