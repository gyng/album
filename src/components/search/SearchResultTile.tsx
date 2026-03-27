import Link from "next/link";
import styles from "./SearchResultTile.module.css";
import { getRelativeTimeString } from "../../util/time";
import { extractDateFromExifString } from "../../util/extractExifFromDb";
import { SearchResultRow } from "./searchTypes";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";

const stripHtml = (value?: string): string => {
  if (!value) {
    return "";
  }

  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const SearchResultTile = (props: {
  result: SearchResultRow;
  onFindSimilar?: (path: string, similarity?: number) => void;
}) => {
  const { result, onFindSimilar } = props;

  let colour = "rgba(255, 255, 255, 0.2)";
  try {
    if (result.colors) {
      const colourRgb = JSON.parse(
        result.colors.replaceAll("(", "[").replaceAll(")", "]"),
      )[0];
      colour = `rgba(${colourRgb[0]}, ${colourRgb[1]}, ${colourRgb[2]}, 1)`;
    }
  } catch (_err) {
    // noop
  }

  const resized = getResizedAlbumImageSrc(result.path);
  const albumName = result.path.split("/").at(-2);
  const dateTimeOriginal = extractDateFromExifString(result.exif);
  const snippet = stripHtml(
    result.snippet || result.alt_text || result.subject || result.tags,
  );
  const imageAlt =
    snippet ||
    stripHtml(result.alt_text) ||
    stripHtml(result.subject) ||
    stripHtml(result.tags);
  const similarityLabel =
    typeof result.similarity === "number"
      ? `${Math.round(result.similarity * 100)}% match`
      : null;
  const scoreTitle =
    typeof result.rrfScore === "number"
      ? `Hybrid search: semantic ${
          typeof result.similarity === "number"
            ? `${Math.round(result.similarity * 100)}%`
            : "n/a"
        }, keyword ${
          typeof result.bm25 === "number"
            ? (result.bm25 * -1).toFixed(1)
            : "n/a"
        }, fused ${result.rrfScore.toFixed(3)}`
      : typeof result.similarity === "number"
        ? result.similarity.toFixed(3)
        : typeof result.bm25 === "number"
          ? (result.bm25 * -1).toFixed(1)
          : undefined;

  return (
    <div className={styles.card}>
      {similarityLabel ? (
        <div className={styles.similarityBadge} title={scoreTitle}>
          {similarityLabel}
        </div>
      ) : null}
      {onFindSimilar ? (
        <button
          type="button"
          className={styles.similarButton}
          aria-label="Find similar photos"
          title="Find similar photos"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onFindSimilar(result.path, result.similarity);
          }}
        >
          <span className={styles.similarButtonIcon}>🔍</span>
        </button>
      ) : null}
      <Link href={result.album_relative_path} className={styles.link}>
        <div className={styles.result}>
          <div className={styles.thumbnailWrap}>
            <picture>
              <img
                className={styles.resultPicture}
                data-testid="result-picture"
                src={resized}
                alt={imageAlt}
                style={{ backgroundColor: colour }}
              ></img>
            </picture>
          </div>
          <div className={styles.details}>
            <div>
              <div className={styles.source}>
                <div className={styles.sourceText}>{albumName}</div>
                <div className={styles.sourceText}>
                  {dateTimeOriginal
                    ? ", " +
                      getRelativeTimeString(dateTimeOriginal, {
                        short: true,
                      }).replace(" ago", "")
                    : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
};
