import { GetStaticProps, NextPage } from "next";
import { getAlbums } from "../../services/album";
import React from "react";
import { MapWorldDeferred } from "../../components/MapWorldDeferred";
import { GlobalNav } from "../../components/GlobalNav";
import { getDegLatLngFromExif } from "../../util/dms2deg";
import { MapWorldEntry, type TimeRange } from "../../components/MapWorld";
import styles from "./map.module.css";
import commonStyles from "../../styles/common.module.css";
import Link from "next/link";
import { useRouter } from "next/router";
import { measureBuild } from "../../services/buildTiming";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";
import { getDefaultRouteMode, RouteMode } from "../../components/mapRoute";
import { TimeRangeSlider } from "../../components/TimeRangeSlider";
import { parseRangeParam, formatRangeDate } from "../../util/timeRange";
import { filterPhotosByQuery, isPhotoInTimeRange } from "../../components/mapWorldViewModel";
import {
  fetchMapSearchIndex,
  getMapPhotoHref,
  getNextBuildId,
  hasMapCoordinates,
} from "../../components/mapSearchIndex";

type PageProps = {
  photos: MapWorldEntry[];
};

const DEBOUNCE_URL_MS = 300;

const WorldMap: NextPage<PageProps> = (props) => {
  const router = useRouter();
  const filterAlbum =
    typeof router.query.filter_album === "string" ? router.query.filter_album : null;
  const hasCameraParams =
    typeof router.query.lat === "string" ||
    typeof router.query.lon === "string" ||
    typeof router.query.zoom === "string";
  const hasRouteState =
    filterAlbum != null ||
    hasCameraParams ||
    typeof router.query.from === "string" ||
    typeof router.query.to === "string";

  // Album filtering (existing)
  const albumFilteredPhotos = React.useMemo(
    () => (filterAlbum ? props.photos.filter((p) => p.album === filterAlbum) : props.photos),
    [props.photos, filterAlbum],
  );

  // Time range state — live during drag, committed on pointer up
  const urlFrom = parseRangeParam(typeof router.query.from === "string" ? router.query.from : null);
  const urlTo = parseRangeParam(typeof router.query.to === "string" ? router.query.to : null, {
    endOfDay: true,
  });
  const [timeRange, setTimeRange] = React.useState<TimeRange | null>(
    urlFrom !== null && urlTo !== null ? { fromMs: urlFrom, toMs: urlTo } : null,
  );
  const [showTimeRangeSlider, setShowTimeRangeSlider] = React.useState(
    urlFrom !== null && urlTo !== null,
  );
  const urlSyncTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from URL on navigation (back/forward)
  React.useEffect(() => {
    if (urlFrom !== null && urlTo !== null) {
      setTimeRange({ fromMs: urlFrom, toMs: urlTo });
      setShowTimeRangeSlider(true);
    } else {
      setTimeRange(null);
    }
  }, [urlFrom, urlTo]);

  const handleTimeRangeDrag = React.useCallback((fromMs: number, toMs: number) => {
    setTimeRange({ fromMs, toMs });
  }, []);

  const handleTimeRangeCommit = React.useCallback(
    (fromMs: number | null, toMs: number | null) => {
      if (fromMs !== null && toMs !== null) {
        setTimeRange({ fromMs, toMs });
      } else {
        setTimeRange(null);
      }

      // Debounced URL update. Derive the base query from the live
      // window.location.search rather than router.query: MMap writes the
      // camera params (lat/lon/zoom) straight to history via replaceState,
      // which the Next router never sees, so router.query is stale and would
      // drop them on commit.
      if (urlSyncTimer.current) clearTimeout(urlSyncTimer.current);
      urlSyncTimer.current = setTimeout(() => {
        const params = new URLSearchParams(window.location.search);
        if (fromMs !== null && toMs !== null) {
          params.set("from", formatRangeDate(fromMs));
          params.set("to", formatRangeDate(toMs));
        } else {
          params.delete("from");
          params.delete("to");
        }
        const query = Object.fromEntries(params.entries());
        router.replace({ query }, undefined, { shallow: true });
      }, DEBOUNCE_URL_MS);
    },
    [router],
  );

  // Clear any pending debounced URL write on unmount so it can't fire against
  // the next page's router after a fast navigation.
  React.useEffect(() => {
    return () => {
      if (urlSyncTimer.current) clearTimeout(urlSyncTimer.current);
    };
  }, []);

  // The compact metadata corpus is a separate static Next data chunk. Loading
  // starts on first search interaction, so the initial map payload stays lean.
  const [mapSearchQuery, setMapSearchQuery] = React.useState("");
  const [mapSearchIndex, setMapSearchIndex] = React.useState<Map<string, string> | null>(null);
  const [mapSearchStatus, setMapSearchStatus] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const mapSearchLoadRef = React.useRef<Promise<void> | null>(null);
  const loadMapSearchIndex = React.useCallback(() => {
    if (mapSearchIndex || mapSearchLoadRef.current) {
      return;
    }
    const buildId = getNextBuildId();
    if (!buildId) {
      setMapSearchStatus("error");
      return;
    }
    setMapSearchStatus("loading");
    const loading = fetchMapSearchIndex(buildId)
      .then((index) => {
        setMapSearchIndex(index);
        setMapSearchStatus("ready");
      })
      .catch((error) => {
        console.error("Failed to progressively load map search", error);
        setMapSearchStatus("error");
      })
      .finally(() => {
        mapSearchLoadRef.current = null;
      });
    mapSearchLoadRef.current = loading;
  }, [mapSearchIndex]);
  const deferredMapSearchQuery = React.useDeferredValue(mapSearchQuery);
  const filteredPhotos = React.useMemo(
    () =>
      deferredMapSearchQuery.trim() && !mapSearchIndex
        ? albumFilteredPhotos
        : filterPhotosByQuery(
            albumFilteredPhotos,
            deferredMapSearchQuery,
            mapSearchIndex ?? undefined,
          ),
    [albumFilteredPhotos, deferredMapSearchQuery, mapSearchIndex],
  );
  const dateFilteredAlbumPhotos = React.useMemo(
    () =>
      timeRange
        ? albumFilteredPhotos.filter((photo) => isPhotoInTimeRange(photo, timeRange))
        : albumFilteredPhotos,
    [albumFilteredPhotos, timeRange],
  );
  const displayedPhotos = React.useMemo(
    () =>
      timeRange
        ? filteredPhotos.filter((photo) => isPhotoInTimeRange(photo, timeRange))
        : filteredPhotos,
    [filteredPhotos, timeRange],
  );
  const routeEligiblePhotoCount = React.useMemo(
    () =>
      displayedPhotos.filter(
        (photo) => typeof photo.decLat === "number" && typeof photo.decLng === "number",
      ).length,
    [displayedPhotos],
  );
  const hasRoute = filterAlbum != null && routeEligiblePhotoCount >= 2;
  const routableAlbumCount = React.useMemo(() => {
    const byAlbum = new Map<string, number>();
    for (const photo of displayedPhotos) {
      if (typeof photo.decLat !== "number" || typeof photo.decLng !== "number") {
        continue;
      }

      byAlbum.set(photo.album, (byAlbum.get(photo.album) ?? 0) + 1);
    }

    return Array.from(byAlbum.values()).filter((count) => count >= 2).length;
  }, [displayedPhotos]);
  const defaultRouteMode = React.useMemo<RouteMode>(
    () => getDefaultRouteMode(displayedPhotos),
    [displayedPhotos],
  );
  const [showAllRoutes, setShowAllRoutes] = React.useState(false);
  React.useEffect(() => {
    if (routableAlbumCount === 0) {
      setShowAllRoutes(false);
    }
  }, [routableAlbumCount]);

  return (
    <div
      className={[styles.container, showTimeRangeSlider ? styles.containerWithSlider : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Seo
        title="Map | Snapshots"
        description="Explore geotagged photos on a world map."
        pathname="/map"
        noindex={hasRouteState}
        jsonLd={buildCollectionPageJsonLd({
          name: "Map | Snapshots",
          description: "Explore geotagged photos on a world map.",
          pathname: "/map",
        })}
      />
      <div className={styles.titleBar}>
        <GlobalNav
          currentPage="map"
          hasPadding={false}
          extraItems={
            <>
              {filterAlbum ? (
                <li>
                  <div className={commonStyles.toast}>
                    Showing only photos from{" "}
                    <Link href={`/album/${filterAlbum}`}>
                      <i>{filterAlbum}</i>
                    </Link>
                  </div>
                </li>
              ) : null}
              {hasRoute ? (
                <li>
                  <div className={commonStyles.toast}>
                    Select a photo to trace its place in this {routeEligiblePhotoCount}-photo
                    journey.
                  </div>
                </li>
              ) : null}
              {!filterAlbum && routableAlbumCount > 0 ? (
                <li>
                  <div className={styles.mapControls}>
                    <button
                      type="button"
                      className={commonStyles.button}
                      aria-pressed={showAllRoutes}
                      onClick={() => {
                        setShowAllRoutes((current) => !current);
                      }}
                    >
                      {showAllRoutes ? "Hide journeys" : `Show ${routableAlbumCount} journeys`}
                    </button>

                    <button
                      type="button"
                      className={[
                        commonStyles.button,
                        showTimeRangeSlider ? commonStyles.active : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-expanded={showTimeRangeSlider}
                      aria-controls="map-date-controls"
                      onClick={() => {
                        setShowTimeRangeSlider((current) => !current);
                      }}
                    >
                      {showTimeRangeSlider ? "Hide date controls" : "Choose dates"}
                    </button>
                  </div>
                </li>
              ) : null}
              {filterAlbum || routableAlbumCount === 0 ? (
                <li>
                  <button
                    type="button"
                    className={[commonStyles.button, showTimeRangeSlider ? commonStyles.active : ""]
                      .filter(Boolean)
                      .join(" ")}
                    aria-expanded={showTimeRangeSlider}
                    aria-controls="map-date-controls"
                    onClick={() => {
                      setShowTimeRangeSlider((current) => !current);
                    }}
                  >
                    {showTimeRangeSlider ? "Hide date controls" : "Choose dates"}
                  </button>
                </li>
              ) : null}
            </>
          }
        />
        <div className={styles.mapSearch} role="search">
          <input
            type="search"
            value={mapSearchQuery}
            onFocus={loadMapSearchIndex}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setMapSearchQuery(nextQuery);
              if (nextQuery.trim()) {
                loadMapSearchIndex();
              }
            }}
            placeholder="Search places, albums or subjects…"
            aria-label="Search photos on the map"
            autoComplete="off"
            spellCheck={false}
            aria-busy={mapSearchStatus === "loading"}
          />
          {mapSearchStatus === "error" ? (
            <>
              <span role="status">Search unavailable</span>
              <button type="button" className={styles.mapSearchRetry} onClick={loadMapSearchIndex}>
                Try again
              </button>
            </>
          ) : (
            <span aria-live="polite">
              {mapSearchStatus === "loading"
                ? "Loading search…"
                : deferredMapSearchQuery.trim() && displayedPhotos.length === 0
                  ? timeRange && filteredPhotos.length > 0
                    ? "No matching photos in these dates."
                    : `No photos match “${deferredMapSearchQuery.trim()}”.`
                  : deferredMapSearchQuery.trim()
                    ? `${displayedPhotos.length} of ${dateFilteredAlbumPhotos.length} photos`
                    : `${displayedPhotos.length} photos`}
            </span>
          )}
        </div>
      </div>

      <MapWorldDeferred
        photos={filteredPhotos}
        className={styles.map}
        fitToPhotos={!hasCameraParams}
        showRoute={!filterAlbum && showAllRoutes}
        routeMode={filterAlbum ? defaultRouteMode : "simplified"}
        routeDisplayMode={!filterAlbum && showAllRoutes ? "always" : "active-only"}
        timeRange={timeRange}
        showDirector
      />

      {showTimeRangeSlider ? (
        <TimeRangeSlider
          id="map-date-controls"
          photos={albumFilteredPhotos}
          fromMs={timeRange?.fromMs ?? null}
          toMs={timeRange?.toMs ?? null}
          onDrag={handleTimeRangeDrag}
          onCommit={handleTimeRangeCommit}
        />
      ) : null}
    </div>
  );
};

export const getStaticProps: GetStaticProps<PageProps> = async () => {
  return measureBuild("page./map.getStaticProps", async () => {
    const albums = await getAlbums();

    const stripped = albums.flatMap((album) => {
      const validPhotos = album.blocks.filter(hasMapCoordinates);

      return validPhotos.map((photo) => {
        const src = photo._build.srcset?.[0];
        const exif = photo._build?.exif ?? {};
        const { GPSLongitude, GPSLatitude, GPSLongitudeRef, GPSLatitudeRef, DateTimeOriginal } =
          exif;

        const { decLng, decLat } = getDegLatLngFromExif({
          GPSLongitude,
          GPSLatitude,
          GPSLongitudeRef,
          GPSLatitudeRef,
        });

        const tags = photo._build?.tags;
        const color = tags?.colors?.[0];

        const entry: MapWorldEntry = {
          album: album._build.slug,
          src,
          decLng,
          decLat,
          date: DateTimeOriginal ?? null,
          href: getMapPhotoHref(album._build.slug, photo),
          placeholderColor: color
            ? `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)`
            : "transparent",
          placeholderHeight: photo._build?.height,
          placeholderWidth: photo._build?.width,
        };
        return entry;
      });
    });

    return { props: { photos: stripped } };
  });
};

export default WorldMap;
