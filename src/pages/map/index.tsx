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
import Head from "next/head";
import { useSearchParams } from "next/navigation";

type PageProps = {
  photos: MapWorldEntry[];
};

const WorldMap: NextPage<PageProps> = (props) => {
  const searchParams = useSearchParams();
  const filterAlbum = searchParams.get("filter_album");
  const filteredPhotos = filterAlbum
    ? props.photos.filter((p) => p.album === filterAlbum)
    : props.photos;

  return (
    <div className={styles.container}>
      <Head>
        <title>Map</title>
        <link rel="icon" href="/favicon.svg" />
        <meta name="theme-color" content="#2c2c2c" />
      </Head>
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
      </div>

      <MapWorldDeferred photos={filteredPhotos} className={styles.map} />
    </div>
  );
};

export const getStaticProps: GetStaticProps<PageProps> = async (context) => {
  const albums = await getAlbums();

  const hasLatLng = (block: Block): boolean => {
    const { GPSLongitude, GPSLatitude, GPSLongitudeRef, GPSLatitudeRef } =
      (block as PhotoBlock)._build?.exif ?? {};
    return (
      block.kind === "photo" &&
      GPSLongitude &&
      GPSLatitude &&
      GPSLongitudeRef &&
      GPSLatitudeRef
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
};

export default WorldMap;
