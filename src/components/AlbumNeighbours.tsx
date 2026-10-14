import { useEffect, useState } from "react";
import {
  albumNeighbours,
  fetchAlbumPreviews,
  type AlbumNeighbours as Neighbours,
} from "../util/albumNeighbours";
import type { AlbumPreview } from "../util/pageDataTypes";
import type { PhotoBlock } from "../services/types";
import { rgbToString } from "../util/colorDistance";
import { AppLink } from "./platform";
import { albumSummary } from "./Albums";
import { Caption, Thumb } from "./ui";
import { ALBUM_STEP_ATTRIBUTE } from "./useAlbumStepping";
import styles from "./AlbumNeighbours.module.css";

const coverOf = (album: AlbumPreview) =>
  (album.blocks.find((block) => block.kind === "photo" && block.formatting?.cover) ??
    album.blocks.find((block) => block.kind === "photo")) as PhotoBlock | undefined;

// The same tile as a search result: a square thumbnail with a line or two
// under it. Full-size covers here read as more of the album's photographs.
const Neighbour = ({ album, side }: { album: AlbumPreview; side: "previous" | "next" }) => {
  const cover = coverOf(album);
  const src = cover?._build.srcset[0]?.src;
  const colour = cover?._build.tags.colors?.[0];
  return (
    <li className={styles.neighbour} data-side={side}>
      <AppLink href={`/album/${album._build.slug}`} className={styles.link}>
        {src ? (
          <Thumb
            src={src}
            loading="lazy"
            {...(colour ? { style: { backgroundColor: rgbToString(colour) } } : {})}
          />
        ) : null}
        <span className={styles.text}>
          <Caption as="span" size="sm">
            {side === "previous" ? "Previous album" : "Next album"}
          </Caption>
          <span className={styles.title}>{album.title ?? album._build.slug}</span>
          <Caption as="span" size="sm">
            {albumSummary(album)}
          </Caption>
        </span>
      </AppLink>
    </li>
  );
};

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
  if (!previous && !next) return null;
  return (
    <nav className={styles.neighbours} aria-label="More albums" {...{ [ALBUM_STEP_ATTRIBUTE]: "" }}>
      <ul className={styles.list}>
        {previous ? <Neighbour album={previous} side="previous" /> : null}
        {next ? <Neighbour album={next} side="next" /> : null}
      </ul>
    </nav>
  );
};
