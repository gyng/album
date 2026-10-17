import React from "react";
import { AppLink as Link } from "./platform";
import type { PhotoBlock } from "../services/types";
import type { AlbumPreview, HomePageData } from "../util/pageDataTypes";
import { Picture } from "./Photo";
import { Caption, Heading, HoverPlayClip } from "./ui";
import { parseExifLocalDateTime } from "../util/exifTime";
import { prefetchImageSrcSet } from "../util/prefetchImage";
import { coverBlockOf, coverClipBlockOf, mediaBlockAsPhoto } from "../util/videoBlockMedia";
import { isPlayableClipPath } from "../util/videoScenePath";
import styles from "./Album.module.css";

/**
 * How long a pointer has to stay before its album counts as being looked at.
 *
 * Without it, one sweep across the grid fetches a full-size photograph for
 * every album it crosses — three of them, measured, from a single move. A fifth
 * of a second is shorter than the gap between arriving and pressing and longer
 * than passing through.
 */
const HOVER_INTENT_MS = 200;

/** "2024–2026 · 52 snaps": an album's years, in its own order, and its size. */
const albumSummary = (album: AlbumPreview): string => {
  const timeRange = album._build.timeRange
    ?.filter(Boolean)
    .map((ts) => parseExifLocalDateTime(ts)?.year ?? 0) ?? [0, 0];
  if (album.formatting.sort === "newest-first") timeRange.reverse();
  const years =
    timeRange[0] && timeRange[1] && timeRange[0] !== timeRange[1]
      ? timeRange.join("–")
      : timeRange[0] || null;
  const photoCount =
    album.photoCount ??
    album.blocks.filter((block) => block.kind === "photo" || block.kind === "video").length;
  const countLabel = `${photoCount.toLocaleString("en-GB")} ${photoCount === 1 ? "snap" : "snaps"}`;
  return years ? `${years} · ${countLabel}` : countLabel;
};

export const Albums: React.FC<HomePageData> = (props) => {
  const firstCoveredAlbumIndex = props.albums.findIndex((album) =>
    album.blocks.some((block) => mediaBlockAsPhoto(block) !== null),
  );
  const intentRef = React.useRef<number | undefined>(undefined);
  React.useEffect(
    () => () => {
      if (intentRef.current !== undefined) window.clearTimeout(intentRef.current);
    },
    [],
  );

  return (
    <ul className={styles.list}>
      {props.albums.map((album, i) => {
        const cover = coverBlockOf(album.blocks);
        // A clip's cover plays the clip it stands for on hover. Only a local
        // clip has a file to play: a YouTube external is indexed as one but has
        // no transcoded MP4, and a photograph is not a clip at all, so both
        // keep the poster they already had.
        const coverClip = coverClipBlockOf(album.blocks);
        const coverClipPath =
          coverClip !== undefined && coverClip.data.type === "local"
            ? `../albums/${album._build.slug}/${coverClip.id}`
            : null;
        const playableCoverClipPath =
          coverClipPath !== null && isPlayableClipPath(coverClipPath) ? coverClipPath : null;
        const firstMedia = album.blocks
          .map(mediaBlockAsPhoto)
          .find((block): block is PhotoBlock => block !== null);

        // The album's first piece of media — a photograph or a clip's poster —
        // fetched while the reader is still deciding. The router prefetches the
        // page; nothing prefetches what the page is *for*, so the largest image
        // on it began loading only once the navigation had finished. `100vw` is
        // that page's own sizes for it, so the browser picks the same candidate
        // and the fetch lands in cache under the URL it will ask for.
        const prefetchFirstPhoto = firstMedia
          ? () => prefetchImageSrcSet(firstMedia._build.srcset, "auto, 100vw")
          : undefined;

        const coverImage = cover ? (
          <Picture
            block={cover}
            thumb
            lazy={i !== firstCoveredAlbumIndex}
            label={`Album cover for ${album._build.slug}`}
            useColourPlaceholder
          />
        ) : null;
        const coverElement =
          coverImage !== null && playableCoverClipPath !== null ? (
            <HoverPlayClip clipPath={playableCoverClipPath} className={styles.hoverPlayWrap}>
              {coverImage}
            </HoverPlayClip>
          ) : (
            coverImage
          );

        return (
          <li key={album._build.slug} className={styles.item}>
            <Link
              href={`/album/${album._build.slug}`}
              className={styles.itemLink}
              aria-label={`View photo album: ${album.title}`}
              // A pointer that stays is a reader deciding; one that passes
              // through is on its way somewhere else. A tap or a focus has said
              // so already, so those do not wait.
              {...(prefetchFirstPhoto
                ? {
                    onPointerEnter: () => {
                      window.clearTimeout(intentRef.current);
                      intentRef.current = window.setTimeout(prefetchFirstPhoto, HOVER_INTENT_MS);
                    },
                    onPointerLeave: () => window.clearTimeout(intentRef.current),
                    onTouchStart: prefetchFirstPhoto,
                    onFocus: prefetchFirstPhoto,
                  }
                : {})}
            >
              {coverElement}
            </Link>

            <div className={styles.name}>
              <Heading level={2} as="h2">
                <span>
                  <Link href={`/album/${album._build.slug}`} tabIndex={-1}>
                    {album.title}
                  </Link>
                </span>
              </Heading>

              <Caption as="span" size="sm" className={styles.date}>
                {albumSummary(album)}
              </Caption>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
