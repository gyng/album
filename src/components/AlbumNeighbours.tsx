import { useEffect, useState } from "react";
import {
  albumNeighbours,
  fetchAlbumPreviews,
  type AlbumNeighbours as Neighbours,
} from "../util/albumNeighbours";
import { Albums } from "./Albums";
import { ALBUM_STEP_ATTRIBUTE } from "./useAlbumStepping";
import styles from "./AlbumNeighbours.module.css";

/**
 * Where an album ends: the albums either side of it, in the home page's order.
 * Fetched rather than built into the page — finding them at build time meant
 * every album page loading every album.
 */
export const AlbumNeighbours = ({ slug }: { slug: string }) => {
  const [neighbours, setNeighbours] = useState<Neighbours>({});
  useEffect(() => {
    let live = true;
    setNeighbours({});
    fetchAlbumPreviews()
      .then((albums) => {
        if (live) setNeighbours(albumNeighbours(albums, slug));
      })
      // The album is complete without them; a failed list leaves nothing behind.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [slug]);
  const { previous, next } = neighbours;
  const albums = [previous, next].filter((album) => album !== undefined);
  if (!albums.length) return null;
  return (
    <nav className={styles.neighbours} aria-label="More albums" {...{ [ALBUM_STEP_ATTRIBUTE]: "" }}>
      <Albums
        albums={albums}
        eager={false}
        kicker={(album) => (album === previous ? "Previous album" : "Next album")}
      />
    </nav>
  );
};
