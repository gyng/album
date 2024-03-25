import Link from "next/link";
import styles from "./SearchResultTile.module.css";
import { SearchResult } from "./api";

export const SearchResultTile = (props: { result: SearchResult }) => {
  const { result } = props;

  // [(92, 124, 161), (213, 200, 192), (9, 9, 11), (152, 187, 215)]
  let colour = "rgba(255, 255, 255, 0.2)";
  try {
    if (result.colors) {
      const colourRgb = JSON.parse(
        result.colors.replaceAll("(", "[").replaceAll(")", "]")
      )[0];
      colour = `rgba(${colourRgb[0]}, ${colourRgb[1]}, ${colourRgb[2]}, 1)`;
    }
  } catch (err) {
    // noop
  }

  // hack, assumed path
  // http://localhost:3000/data/albums/kuching/.resized_images/DSCF4490.JPG@2400.avif
  const imageSrc = result.path.replace("../src/public", "");
  const resized =
    [
      ...imageSrc.split("/").slice(0, -1),
      ".resized_images",
      ...imageSrc.split("/").slice(-1),
    ].join("/") + "@600.avif";
  const albumName = result.path.split("/").at(-2);

  return (
    <Link href={result.album_relative_path} className={styles.link}>
      <div className={styles.result}>
        <picture>
          <img
            className={styles.resultPicture}
            data-testid="result-picture"
            src={resized}
            alt={result.tags}
            style={{ backgroundColor: colour }}
          ></img>
        </picture>
        <div className={styles.details}>
          <div>
            <div
              className={styles.snippet}
              dangerouslySetInnerHTML={{ __html: result.snippet }}
              title={(result.bm25 * -1).toFixed(1)}
            />
            <div>{albumName}</div>
          </div>
        </div>
      </div>
    </Link>
  );
};
