import { AppLink as Link } from "../platform";
import { Thumb, OverlayButton } from "../ui";
import styles from "./SearchResultTile.module.css";
import { HydratedRelativeTime } from "../HydratedRelativeTime";
import { extractDateFromExifString } from "../../util/extractExifFromDb";
import { SearchResultRow } from "./searchTypes";
import { RGB, rgbToString, parseColorPalette } from "../../util/colorDistance";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";
import { formatDuration } from "../../util/formatDuration";
import { sceneSecondsOf } from "../../util/videoScenePath";

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
  const { result, onFindSimilar, onSearchByColor, persistColorAction = false } = props;

  let colour = "var(--c-border-on-dark)";
  const palette = result.colors ? parseColorPalette(result.colors) : [];
  if (result.colors) {
    const firstColor = palette[0];
    if (firstColor) colour = rgbToString(firstColor);
  }

  const resized = getResizedAlbumImageSrc(result.path);
  const albumName = result.path.split("/").at(-2);
  const dateTimeOriginal = extractDateFromExifString(result.exif);
  const snippet = stripHtml(result.snippet || result.alt_text || result.subject || result.tags);
  const imageAlt =
    snippet || stripHtml(result.alt_text) || stripHtml(result.subject) || stripHtml(result.tags);
  const isHybridResult = typeof result.rrfScore === "number";
  // Colour match uses its own 0–100 field, so a semantic cosine (0–1) that
  // coexists with a colour swatch is never mistaken for a colour percentage.
  const colorMatchScore =
    typeof result.colorMatchScore === "number" ? result.colorMatchScore : null;
  const hybridScore = isHybridResult ? result.rrfScore : null;
  const hybridScoreLabel =
    typeof hybridScore === "number" ? `${Math.round(hybridScore * 1000)}` : null;
  const similarityLabel = isHybridResult
    ? hybridScoreLabel
    : typeof colorMatchScore === "number"
      ? `${Math.round(colorMatchScore)}%`
      : typeof result.similarity === "number"
        ? `${Math.round(result.similarity * 100)}%`
        : null;
  const actionColor = result.matchingColor ?? (palette[0] as RGB | undefined) ?? null;
  const matchingColorStyle = actionColor ? rgbToString(actionColor) : null;
  const scoreTitle = isHybridResult
    ? `Hybrid search: semantic ${
        typeof result.similarity === "number" ? `${Math.round(result.similarity * 100)}%` : "n/a"
      }, keyword ${
        typeof result.bm25 === "number" ? (result.bm25 * -1).toFixed(1) : "n/a"
      }, fused score ${hybridScore?.toFixed(3)} (${hybridScoreLabel})`
    : typeof colorMatchScore === "number"
      ? `Colour match score ${Math.round(colorMatchScore)}%`
      : typeof result.similarity === "number"
        ? result.similarity.toFixed(3)
        : undefined;

  // A video's thumbnail is the frame extracted from it, so nothing about the
  // tile would otherwise say that clicking through gets you something that
  // plays. A scene result is a moment inside a clip, and the moment — not the
  // clip's full length — is what explains why this frame came back.
  const isVideo = result.mediaKind === "video";
  const sceneSeconds = sceneSecondsOf(result.path);
  const momentLabel = formatDuration(sceneSeconds);
  const durationLabel = momentLabel ?? formatDuration(result.durationSeconds);
  const videoLabel = momentLabel
    ? `Video at ${momentLabel}`
    : durationLabel
      ? `Video, ${durationLabel}`
      : "Video";

  return (
    <div className={styles.card}>
      {isVideo ? (
        <div
          className={`${styles.overlayBadge} ${styles.videoBadge}`}
          role="img"
          aria-label={videoLabel}
        >
          <span className={styles.videoBadgeIcon} aria-hidden="true">
            ▶
          </span>
          {durationLabel ? <span>{durationLabel}</span> : null}
        </div>
      ) : null}
      {similarityLabel ? (
        <div className={`${styles.overlayBadge} ${styles.similarityBadge}`} title={scoreTitle}>
          {similarityLabel}
        </div>
      ) : null}
      {onFindSimilar || (matchingColorStyle && onSearchByColor) ? (
        <div
          className={[
            styles.actionButtons,
            persistColorAction ? styles.actionButtonsPersistent : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {matchingColorStyle && onSearchByColor && actionColor ? (
            <OverlayButton
              aria-label="Use this photo's colour"
              title={`Use this photo's colour: ${matchingColorStyle}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSearchByColor(actionColor);
              }}
            >
              <span
                data-colour-swatch
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
              <div className={styles.sourceText}>
                {albumName}
                {dateTimeOriginal ? "," : null}
              </div>
              {dateTimeOriginal ? (
                <div
                  className={styles.sourceText}
                  title={dateTimeOriginal.toLocaleDateString("en-GB")}
                >
                  <HydratedRelativeTime date={dateTimeOriginal} short trimPastSuffix />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
};
