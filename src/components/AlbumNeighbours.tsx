import { useEffect, useState } from "react";
import {
  albumNeighbours,
  fetchAlbumPreviews,
  type AlbumNeighbours as Neighbours,
} from "../util/albumNeighbours";
import type { AlbumPreview } from "../util/pageDataTypes";
import { coverBlockOf, coverClipBlockOf } from "../util/videoBlockMedia";
import { isPlayableClipPath } from "../util/videoScenePath";
import { rgbToString } from "../util/colorDistance";
import { AppLink } from "./platform";
import { Caption, HoverPlayClip, Thumb } from "./ui";
import { ALBUM_STEP_ATTRIBUTE } from "./useAlbumStepping";
import photoStyles from "./Photo.module.css";
import styles from "./AlbumNeighbours.module.css";

// The same tile as a search result: a square thumbnail with a line or two
// under it. Full-size covers here read as more of the album's photographs.
const Neighbour = ({ album, side }: { album: AlbumPreview; side: "previous" | "next" }) => {
  const cover = coverBlockOf(album.blocks);
  // A neighbouring album of clips alone shows a clip's poster, and pointing at
  // it plays the clip. Only a local clip has a file to play: a YouTube external
  // is indexed as one but has no transcoded MP4, and a photograph is not a clip
  // at all, so both keep the poster they already had.
  const coverClip = coverClipBlockOf(album.blocks);
  const coverClipPath =
    coverClip !== undefined && coverClip.data.type === "local"
      ? `../albums/${album._build.slug}/${coverClip.id}`
      : null;
  const playableCoverClipPath =
    coverClipPath !== null && isPlayableClipPath(coverClipPath) ? coverClipPath : null;
  const src = cover?._build.srcset[0]?.src;
  const colour = cover?._build.tags.colors?.[0];
  const thumbnail = src ? (
    <Thumb
      src={src}
      loading="lazy"
      {...(colour ? { style: { backgroundColor: rgbToString(colour) } } : {})}
    />
  ) : null;
  return (
    <li className={styles.neighbour} data-side={side}>
      <AppLink href={`/album/${album._build.slug}`} className={styles.link}>
        {thumbnail !== null && playableCoverClipPath !== null ? (
          <HoverPlayClip clipPath={playableCoverClipPath} className={styles.hoverPlayWrap}>
            {thumbnail}
          </HoverPlayClip>
        ) : (
          thumbnail
        )}
        <span className={styles.text}>
          <Caption as="span" size="sm">
            {side === "previous" ? "Previous album" : "Next album"}
          </Caption>
          <span className={styles.title}>{album.title ?? album._build.slug}</span>
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
export const AlbumNeighbours = ({
  slug,
  frame,
}: {
  slug: string;
  /** The album's widest photograph, whose edges the tiles line up with. */
  frame?: { width: number; height: number };
}) => {
  // Kept with the album they were found for, so another album's never show.
  const [found, setFound] = useState<{ slug: string; neighbours: Neighbours } | null>(null);
  useEffect(() => {
    let live = true;
    fetchAlbumPreviews()
      .then((albums) => {
        if (live) setFound({ slug, neighbours: albumNeighbours(albums, slug) });
      })
      // The album is complete without them; a failed list leaves nothing behind.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [slug]);
  const { previous, next } = found?.slug === slug ? found.neighbours : {};
  if (!previous && !next) return null;
  return (
    <nav className={styles.neighbours} aria-label="More albums" {...{ [ALBUM_STEP_ATTRIBUTE]: "" }}>
      {/* A photograph's own block, sized like the album's widest photograph, so the
          tiles line up with its edges. */}
      <div
        className={[photoStyles.block, styles.frame].join(" ")}
        {...(frame
          ? {
              style: {
                ["--photo-aspect" as string]: (frame.width / Math.max(1, frame.height)).toFixed(4),
                ["--photo-intrinsic-width" as string]: `${frame.width}px`,
              },
            }
          : {})}
      >
        <ul className={styles.list}>
          {previous ? <Neighbour album={previous} side="previous" /> : null}
          {next ? <Neighbour album={next} side="next" /> : null}
        </ul>
      </div>
    </nav>
  );
};
