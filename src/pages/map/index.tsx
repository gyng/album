import { GetStaticProps, NextPage } from "next";
import { getAlbums } from "../../services/album";
import React from "react";
import { MapWorldDeferred } from "../../components/MapWorldDeferred";
import { Block, PhotoBlock } from "../../services/types";
import { getDegLatLngFromExif } from "../../util/dms2deg";
import { MapWorldEntry } from "../../components/MapWorld";
import styles from "./map.module.css";
import Link from "next/link";
import Head from "next/head";

type PageProps = {
  photos: MapWorldEntry[];
};

const WorldMap: NextPage<PageProps> = (props) => {
  return (
    <div className={styles.container}>
      <Head>
        <title>Map</title>
      </Head>
      <div className={styles.titleBar}>
        <h1 className={styles.title}>🌏</h1>
        <Link href="/">Home</Link>
      </div>
      <MapWorldDeferred photos={props.photos} className={styles.map} />
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

      return {
        album: album._build.slug,
        src,
        decLng,
        decLat,
        date: DateTimeOriginal,
        href: `/album/${album._build.slug}#${filename}`,
      };
    });
  });

  return { props: { photos: stripped, test: albums } };
};

export default WorldMap;
