import Link from "next/link";
import styles from "./SearchResultTile.module.css";
import { getRelativeTimeString } from "../../util/time";
import { extractDateFromExifString } from "../../util/extractExifFromDb";
import { SearchResultRow } from "./searchTypes";
import {
  RGB,
  rgbToString,
  parseColorPalette,
} from "../../util/colorDistance";
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
  onSearchByColor?: (color: RGB) => void;
}) => {
  const { result, onFindSimilar, onSearchByColor } = props;

  let colour = "rgba(255, 255, 255, 0.2)";
  if (result.colors) {
    const firstColor = parseColorPalette(result.colors)[0];
    if (firstColor) colour = rgbToString(firstColor);
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
  const isHybridResult = typeof result.rrfScore === "number";
  const isColorMatchResult =
    Array.isArray(result.matchingColor) && typeof result.similarity === "number";
  const hybridScore = isHybridResult ? result.rrfScore : null;
  const hybridScoreLabel =
    typeof hybridScore === "number"
      ? `${Math.round(hybridScore * 1000)}`
      : null;
  const similarityLabel = isHybridResult
    ? hybridScoreLabel
    : isColorMatchResult
      ? `${Math.round(result.similarity)}%`
      : typeof result.similarity === "number"
      ? `${Math.round(result.similarity * 100)}%`
      : null;
  const matchingColorStyle = result.matchingColor ? rgbToString(result.matchingColor) : null;
  const scoreTitle =
    isHybridResult
      ? `Hybrid search: semantic ${
          typeof result.similarity === "number"
            ? `${Math.round(result.similarity * 100)}%`
            : "n/a"
        }, keyword ${
          typeof result.bm25 === "number"
            ? (result.bm25 * -1).toFixed(1)
            : "n/a"
        }, fused score ${hybridScore?.toFixed(3)} (${hybridScoreLabel})`
      : isColorMatchResult
        ? `Color match score ${Math.round(result.similarity)}%`
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
      {onFindSimilar || (matchingColorStyle && onSearchByColor) ? (
        <div className={styles.actionButtons}>
          {matchingColorStyle && onSearchByColor && result.matchingColor ? (
            <button
              type="button"
              className={styles.actionButton}
              aria-label="Search by matched color"
              title={`Search by matched color: ${matchingColorStyle}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSearchByColor(result.matchingColor as RGB);
              }}
            >
              <span
                className={styles.actionColorSwatch}
                style={{ backgroundColor: matchingColorStyle }}
              />
            </button>
          ) : null}
          {onFindSimilar ? (
            <button
              type="button"
              className={styles.actionButton}
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
        </div>
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
      </Link>
    </div>
  );
};
