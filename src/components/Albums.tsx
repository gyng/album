import Link from "next/link";
import { Content, PhotoBlock } from "../api/types";
import { Picture } from "./Photo";
import styles from "./Album.module.css";

export const Albums: React.FC<{ albums: Content[] }> = (props) => {
  return (
    <ul className={styles.list}>
      {props.albums.map((album) => {
        const cover = album.blocks.find((b) => b.kind === "photo");

        const timeRange = album._build?.timeRange
          ?.filter(Boolean)
          .map((ts) => new Date(ts!).getFullYear()) ?? [0, 0];

        return (
          <li key={album._build.slug} className={styles.item}>
            <Link href={`/album/${album._build.slug}`}>
              <a className={styles.itemLink}>
                {cover ? <Picture block={cover as PhotoBlock} thumb /> : null}
              </a>
            </Link>

            <div>
              <Link href={`/album/${album._build.slug}`}>
                <a>
                  <h2 className={styles.name}>{album.title ?? album.name}</h2>
                </a>
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