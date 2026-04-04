import { GetStaticProps, NextPage } from "next";
import { getAlbums } from "../../services/album";
import React from "react";
import { MapWorldDeferred } from "../../components/MapWorldDeferred";
import { GlobalNav } from "../../components/GlobalNav";
import { Block, PhotoBlock } from "../../services/types";
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

type PageProps = {
  photos: MapWorldEntry[];
};

const DEBOUNCE_URL_MS = 300;

const WorldMap: NextPage<PageProps> = (props) => {
  const router = useRouter();
  const filterAlbum =
    typeof router.query.filter_album === "string"
      ? router.query.filter_album
      : null;
  const hasRouteState =
    filterAlbum != null ||
    typeof router.query.lat === "string" ||
    typeof router.query.lon === "string" ||
    typeof router.query.zoom === "string" ||
    typeof router.query.from === "string" ||
    typeof router.query.to === "string";

  // Album filtering (existing)
  const albumFilteredPhotos = React.useMemo(
    () =>
      filterAlbum
        ? props.photos.filter((p) => p.album === filterAlbum)
        : props.photos,
    [props.photos, filterAlbum],
  );

  // Time range state — live during drag, committed on pointer up
  const urlFrom = parseRangeParam(
    typeof router.query.from === "string" ? router.query.from : null,
  );
  const urlTo = parseRangeParam(
    typeof router.query.to === "string" ? router.query.to : null,
    { endOfDay: true },
  );
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

  const handleTimeRangeDrag = React.useCallback(
    (fromMs: number, toMs: number) => {
      setTimeRange({ fromMs, toMs });
    },
    [],
  );

  const handleTimeRangeCommit = React.useCallback(
    (fromMs: number | null, toMs: number | null) => {
      if (fromMs !== null && toMs !== null) {
        setTimeRange({ fromMs, toMs });
      } else {
        setTimeRange(null);
      }

      // Debounced URL update
      if (urlSyncTimer.current) clearTimeout(urlSyncTimer.current);
      urlSyncTimer.current = setTimeout(() => {
        const query = { ...router.query };
        if (fromMs !== null && toMs !== null) {
          query.from = formatRangeDate(fromMs);
          query.to = formatRangeDate(toMs);
        } else {
          delete query.from;
          delete query.to;
        }
        router.replace({ query }, undefined, { shallow: true });
      }, DEBOUNCE_URL_MS);
    },
    [router],
  );

  // Use album-filtered photos for the map (time filtering is done via opacity)
  const filteredPhotos = albumFilteredPhotos;
  const routeEligiblePhotoCount = React.useMemo(
    () =>
      filteredPhotos.filter(
        (photo) =>
          typeof photo.decLat === "number" && typeof photo.decLng === "number",
      ).length,
    [filteredPhotos],
  );
  const hasRoute = filterAlbum != null && routeEligiblePhotoCount >= 2;
  const routableAlbumCount = React.useMemo(() => {
    const byAlbum = new Map<string, number>();
    for (const photo of props.photos) {
      if (
        typeof photo.decLat !== "number" ||
        typeof photo.decLng !== "number"
      ) {
        continue;
      }

      byAlbum.set(photo.album, (byAlbum.get(photo.album) ?? 0) + 1);
    }

    return Array.from(byAlbum.values()).filter((count) => count >= 2).length;
  }, [props.photos]);
  const defaultRouteMode = React.useMemo<RouteMode>(
    () => getDefaultRouteMode(filteredPhotos),
    [filteredPhotos],
  );
  const [showAllRoutes, setShowAllRoutes] = React.useState(false);

  return (
    <div className={styles.container}>
      <Seo
        title="Map | Snapshots"
        description="Browse photo locations across the world map."
        pathname="/map"
        noindex={hasRouteState}
        jsonLd={buildCollectionPageJsonLd({
          name: "Map | Snapshots",
          description: "Browse photo locations across the world map.",
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
                    only showing photos from{" "}
                    <Link href={`/album/${filterAlbum}`}>
                      <i>{filterAlbum}</i>
                    </Link>
                  </div>
                </li>
              ) : null}
              {hasRoute ? (
                <li>
                  <div className={commonStyles.toast}>
                    Hover or select a photo to trace the journey across{" "}
                    {routeEligiblePhotoCount} geotagged photo
                    {routeEligiblePhotoCount === 1 ? "" : "s"}.
                  </div>
                </li>
              ) : null}
              {!filterAlbum && routableAlbumCount > 0 ? (
                <li>
                  <div className={styles.mapControls}>
                    <button
                      type="button"
                      className={commonStyles.button}
                      onClick={() => {
                        setShowAllRoutes((current) => !current);
                      }}
                    >
                      {showAllRoutes ? "Hide all journeys" : "Show all journeys"}
                    </button>

                    <button
                      type="button"
                      className={[
                        commonStyles.button,
                        showTimeRangeSlider ? commonStyles.active : "",
                      ].filter(Boolean).join(" ")}
                      aria-pressed={showTimeRangeSlider}
                      onClick={() => {
                        setShowTimeRangeSlider((current) => !current);
                      }}
                    >
                      {showTimeRangeSlider ? "Hide date range" : "Show date range"}
                    </button>
                  </div>
                </li>
              ) : null}
              {(filterAlbum || routableAlbumCount === 0) ? (
                <li>
                  <button
                    type="button"
                    className={[
                      commonStyles.button,
                      showTimeRangeSlider ? commonStyles.active : "",
                    ].filter(Boolean).join(" ")}
                    aria-pressed={showTimeRangeSlider}
                    onClick={() => {
                      setShowTimeRangeSlider((current) => !current);
                    }}
                  >
                    {showTimeRangeSlider ? "Hide date range" : "Show date range"}
                  </button>
                </li>
              ) : null}
            </>
          }
        />
      </div>

      <MapWorldDeferred
        photos={filteredPhotos}
        className={styles.map}
        showRoute={!filterAlbum && showAllRoutes}
        routeMode={filterAlbum ? defaultRouteMode : "simplified"}
        routeDisplayMode={
          !filterAlbum && showAllRoutes ? "always" : "active-only"
        }
        timeRange={timeRange}
      />

      {showTimeRangeSlider ? (
        <TimeRangeSlider
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

export const getStaticProps: GetStaticProps<PageProps> = async (context) => {
  return measureBuild("page./map.getStaticProps", async () => {
    const albums = await getAlbums();

    const hasLatLng = (block: Block): boolean => {
      const { GPSLongitude, GPSLatitude, GPSLongitudeRef, GPSLatitudeRef } =
        (block as PhotoBlock)._build?.exif ?? {};
      return Boolean(
        block.kind === "photo" &&
        GPSLongitude &&
        GPSLatitude &&
        GPSLongitudeRef &&
        GPSLatitudeRef,
      );
    };

    const stripped = albums.flatMap((album) => {
      const validPhotos = album.blocks.filter(hasLatLng) as PhotoBlock[];

      return validPhotos.map((photo) => {
        const src = photo._build.srcset?.[0];
        const exif = (photo as PhotoBlock)._build?.exif ?? {};
        const {
          GPSLongitude,
          GPSLatitude,
          GPSLongitudeRef,
          GPSLatitudeRef,
          DateTimeOriginal,
        } = exif;

        const { decLng, decLat } = getDegLatLngFromExif({
          GPSLongitude,
          GPSLatitude,
          GPSLongitudeRef,
          GPSLatitudeRef,
        });

        const filename = photo.data.src.split("/").at(-1);

        const color = photo._build?.tags?.colors?.[0];

        const entry: MapWorldEntry = {
          album: album._build.slug,
          src,
          decLng,
          decLat,
          date: DateTimeOriginal ?? null,
          href: `/album/${album._build.slug}#${filename}`,
          placeholderColor: color
            ? `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)`
            : "transparent",
          placeholderHeight: photo._build?.height,
          placeholderWidth: photo._build?.width,
        };
        return entry;
      });
    });

    return { props: { photos: stripped, test: albums } };
  });
};

export default WorldMap;
