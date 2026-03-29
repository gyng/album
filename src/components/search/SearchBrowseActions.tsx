import Link from "next/link";
import styles from "./Search.module.css";
import { forceDocumentNavigation } from "./searchUtils";

type Props = {
  databaseReady: boolean;
  isRandomSimilarLoading: boolean;
  randomExploreError: string | null;
  onLoadRandomSimilarTrail: () => void;
};

export const SearchBrowseActions: React.FC<Props> = ({
  databaseReady,
  isRandomSimilarLoading,
  randomExploreError,
  onLoadRandomSimilarTrail,
}) => {
  return (
    <div className={styles.browseActionsBar}>
      <div className={styles.exploreActions}>
        <button
          type="button"
          className={styles.exploreAction}
          aria-label="Random similarity trail"
          onClick={onLoadRandomSimilarTrail}
          disabled={!databaseReady || isRandomSimilarLoading}
        >
          {isRandomSimilarLoading
            ? "Picking a random photo..."
            : "🎲 Random similarity trail"}
        </button>
        <Link
          href="/map"
          prefetch={false}
          className={styles.secondaryAction}
          aria-label="Explore the map"
          onClick={(event) => {
            forceDocumentNavigation(event, "/map");
          }}
        >
          🗺️ Explore the map
        </Link>
        <Link
          href="/slideshow"
          prefetch={false}
          className={styles.secondaryAction}
          aria-label="Open slideshow"
          onClick={(event) => {
            forceDocumentNavigation(event, "/slideshow");
          }}
        >
          🖼️ Open slideshow
        </Link>
        <Link
          href="/timeline"
          prefetch={false}
          className={styles.secondaryAction}
          aria-label="Browse timeline"
          onClick={(event) => {
            forceDocumentNavigation(event, "/timeline");
          }}
        >
          📅 Browse timeline
        </Link>
      </div>

      {randomExploreError ? (
        <div className={styles.inlineError}>{randomExploreError}</div>
      ) : null}
    </div>
  );
};
