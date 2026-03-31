import Link from "next/link";
import { Thumb } from "../Thumb";
import { OverlayButton } from "../OverlayButton";
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
  persistColorAction?: boolean;
}) => {
  const { result, onFindSimilar, onSearchByColor, persistColorAction = false } =
    props;

  let colour = "rgba(255, 255, 255, 0.2)";
  const palette = result.colors ? parseColorPalette(result.colors) : [];
  if (result.colors) {
    const firstColor = palette[0];
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
  const colorMatchScore = isColorMatchResult ? result.similarity : null;
  const hybridScore = isHybridResult ? result.rrfScore : null;
  const hybridScoreLabel =
    typeof hybridScore === "number"
      ? `${Math.round(hybridScore * 1000)}`
      : null;
  const similarityLabel = isHybridResult
    ? hybridScoreLabel
    : typeof colorMatchScore === "number"
      ? `${Math.round(colorMatchScore)}%`
      : typeof result.similarity === "number"
      ? `${Math.round(result.similarity * 100)}%`
      : null;
  const actionColor = result.matchingColor ?? (palette[0] as RGB | undefined) ?? null;
  const matchingColorStyle = actionColor ? rgbToString(actionColor) : null;
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
      : typeof colorMatchScore === "number"
        ? `Colour match score ${Math.round(colorMatchScore)}%`
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
          {matchingColorStyle && onSearchByColor && actionColor ? (
            <OverlayButton
              className={persistColorAction ? styles.actionButtonPersistent : undefined}
              aria-label="Use this photo's colour"
              title={`Use this photo's colour: ${matchingColorStyle}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSearchByColor(actionColor);
              }}
            >
              <span
                className={styles.actionColorSwatch}
                style={{ backgroundColor: matchingColorStyle }}
              />
            </OverlayButton>
          ) : null}
          {onFindSimilar ? (
            <OverlayButton
              aria-label="Find similar photos"
              title="Find similar photos"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onFindSimilar(result.path, result.similarity);
              }}
            >
              <span className={styles.similarButtonIcon}>🔍</span>
            </OverlayButton>
          ) : null}
        </div>
      ) : null}
      <Link href={result.album_relative_path} className={styles.link}>
        <div className={styles.result}>
          <div className={styles.thumbnailWrap}>
            <picture>
              <Thumb
                className={styles.resultPicture}
                data-testid="result-picture"
                src={resized}
                alt={imageAlt}
                style={{ backgroundColor: colour }}
              />
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
