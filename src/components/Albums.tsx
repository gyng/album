import Link from "next/link";
import { Content, PhotoBlock } from "../services/types";
import { Picture } from "./Photo";
import styles from "./Album.module.css";

export const Albums: React.FC<{ albums: Content[] }> = (props) => {
  return (
    <ul className={styles.list}>
      {props.albums.map((album, i) => {
        const firstPhoto = album.blocks.find((b) => b.kind === "photo");
        const cover =
          album.blocks.find((b) => b.kind === "photo" && b.formatting?.cover) ??
          firstPhoto;

        const timeRange = album._build?.timeRange
          ?.filter(Boolean)
          .map((ts) => new Date(ts!).getFullYear()) ?? [0, 0];

        return (
          <li key={album._build.slug} className={styles.item}>
            <Link
              href={`/album/${album._build.slug}`}
              className={styles.itemLink}
              aria-label={`View photo album: ${album._build.slug}`}
            >
              {cover ? (
                <Picture
                  block={cover as PhotoBlock}
                  thumb
                  lazy={i > 6}
                  label={`Album cover for ${album._build.slug}`}
                />
              ) : null}
            </Link>

            <div>
              <Link
                href={`/album/${album._build.slug}`}
                className={styles.name}
                aria-label={`View photo album: ${album._build.slug}`}
              >
                <h2>{album.title ?? album.name}</h2>
              </Link>

              {timeRange[0] && timeRange[1] && timeRange[0] !== timeRange[1] ? (
                <small className={styles.date}>{timeRange.join("–")}</small>
              ) : timeRange[0] ? (
                <small className={styles.date}>{timeRange[0]}</small>
              ) : (
                <small className={styles.date}>&nbsp;</small>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
