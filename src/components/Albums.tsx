import React from "react";
import { AppLink as Link } from "./platform";
import type { Content, PhotoBlock } from "../services/types";
import { Picture } from "./Photo";
import { Caption, Heading } from "./ui";
import { parseExifLocalDateTime } from "../util/exifTime";
import { prefetchImageSrcSet } from "../util/prefetchImage";
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

export const Albums: React.FC<{ albums: Content[] }> = (props) => {
  const firstCoveredAlbumIndex = props.albums.findIndex((album) =>
    album.blocks.some((block) => block.kind === "photo"),
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
        const firstPhoto = album.blocks.find((b) => b.kind === "photo");
        const cover =
          album.blocks.find((b) => b.kind === "photo" && b.formatting?.cover) ?? firstPhoto;

        // The album's first photograph, fetched while the reader is still
        // deciding. The router prefetches the page; nothing prefetches what the
        // page is *for*, so the largest image on it began loading only once the
        // navigation had finished. `100vw` is that page's own sizes for it, so
        // the browser picks the same candidate and the fetch lands in cache
        // under the URL it will ask for.
        const prefetchFirstPhoto = firstPhoto
          ? () => prefetchImageSrcSet((firstPhoto as PhotoBlock)._build.srcset, "auto, 100vw")
          : undefined;

        const timeRange = album._build.timeRange
          ?.filter(Boolean)
          .map((ts) => parseExifLocalDateTime(ts)?.year ?? 0) ?? [0, 0];

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
              {cover ? (
                <Picture
                  block={cover as PhotoBlock}
                  thumb
                  lazy={i !== firstCoveredAlbumIndex}
                  label={`Album cover for ${album._build.slug}`}
                  useColourPlaceholder
                />
              ) : null}
            </Link>

            <div className={styles.name}>
              <Heading level={2} as="h2">
                <span>
                  <Link href={`/album/${album._build.slug}`} tabIndex={-1}>
                    {album.title}
                  </Link>
                </span>
              </Heading>

              {timeRange[0] && timeRange[1] && timeRange[0] !== timeRange[1] ? (
                <Caption as="span" size="sm" className={styles.date}>
                  {timeRange.join("–")}
                </Caption>
              ) : timeRange[0] ? (
                <Caption as="span" size="sm" className={styles.date}>
                  {timeRange[0]}
                </Caption>
              ) : (
                <Caption as="span" size="sm" className={styles.date}>
                  &nbsp;
                </Caption>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
