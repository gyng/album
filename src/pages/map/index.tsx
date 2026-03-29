import { GetStaticProps, NextPage } from "next";
import { getAlbums } from "../../services/album";
import React from "react";
import { MapWorldDeferred } from "../../components/MapWorldDeferred";
import { Block, PhotoBlock } from "../../services/types";
import { getDegLatLngFromExif } from "../../util/dms2deg";
import { MapWorldEntry } from "../../components/MapWorld";
import styles from "./map.module.css";
import commonStyles from "../../styles/common.module.css";
import Link from "next/link";
import { useRouter } from "next/router";
import { measureBuild } from "../../services/buildTiming";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";
import {
  getDefaultRouteMode,
  ROUTE_SIMPLIFY_THRESHOLD,
  RouteMode,
} from "../../components/mapRoute";

type PageProps = {
  photos: MapWorldEntry[];
};

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
    typeof router.query.zoom === "string";
  const filteredPhotos = filterAlbum
    ? props.photos.filter((p) => p.album === filterAlbum)
    : props.photos;
  const routeEligiblePhotoCount = React.useMemo(
    () =>
      filteredPhotos.filter(
        (photo) =>
          typeof photo.decLat === "number" && typeof photo.decLng === "number",
      ).length,
    [filteredPhotos],
  );
  const hasRoute = filterAlbum != null && routeEligiblePhotoCount >= 2;
  const defaultRouteMode = React.useMemo<RouteMode>(
    () => getDefaultRouteMode(filteredPhotos),
    [filteredPhotos],
  );
  const [showRoute, setShowRoute] = React.useState(
    hasRoute && router.query.route === "1",
  );
  const [routeMode, setRouteMode] = React.useState<RouteMode>(defaultRouteMode);

  React.useEffect(() => {
    setShowRoute(hasRoute && router.query.route === "1");
  }, [hasRoute, router.query.route]);

  React.useEffect(() => {
    setRouteMode(defaultRouteMode);
  }, [defaultRouteMode]);

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
      <div className={[styles.titleBar, commonStyles.topBar].join(" ")}>
        <Link href="/" className={commonStyles.button}>
          ← Albums
        </Link>

        {filterAlbum ? (
          <div className={commonStyles.toast}>
            only showing photos from{" "}
            <Link href={`/album/${filterAlbum}`}>
              <i>{filterAlbum}</i>
            </Link>
          </div>
        ) : null}
        {hasRoute ? (
          <>
            <button
              type="button"
              className={commonStyles.button}
              onClick={() => {
                setShowRoute((current) => !current);
              }}
            >
              {showRoute ? "Hide journey line" : "Show journey line"}
            </button>
            {routeEligiblePhotoCount > 20 ? (
              <button
                type="button"
                className={commonStyles.button}
                onClick={() => {
                  setRouteMode((current) =>
                    current === "full" ? "simplified" : "full",
                  );
                }}
              >
                {routeMode === "full"
                  ? "Use simplified stops"
                  : "Use every photo"}
              </button>
            ) : null}
            <div className={commonStyles.toast}>
              {routeEligiblePhotoCount} geotagged photo
              {routeEligiblePhotoCount === 1 ? "" : "s"}
              {routeEligiblePhotoCount > ROUTE_SIMPLIFY_THRESHOLD
                ? " • simplified by default"
                : ""}
            </div>
          </>
        ) : null}
      </div>

      <MapWorldDeferred
        photos={filteredPhotos}
        className={styles.map}
        showRoute={showRoute}
        routeMode={routeMode}
        routeDisplayMode={
          filterAlbum ? (showRoute ? "always" : "active-only") : "active-only"
        }
      />
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
