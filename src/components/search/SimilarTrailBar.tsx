import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import styles from "./Search.module.css";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";
import { SimilarityOrder } from "./searchUtils";

export type SimilarTrailItem = {
  path: string;
  similarity?: number;
};

type BreadcrumbEntry = SimilarTrailItem & {
  idx: number;
  key: string;
};

const useSafeLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const getAlbumAnchorHref = (path: string): string => {
  const segments = path.split("/");
  const albumName = segments.at(-2);
  const filename = segments.at(-1);

  if (!albumName || !filename) {
    return "/search";
  }

  return `/album/${albumName}#${filename}`;
};

type Props = {
  similarPath: string;
  similarPreviewSrc: string | null;
  similarFilename: string | null;
  similarityOrder: SimilarityOrder;
  trail: SimilarTrailItem[];
  sourceRef: React.RefObject<HTMLDivElement | null>;
  onSetSimilarityOrder: (nextOrder: SimilarityOrder) => void;
  onTruncate: (breadcrumbIndex: number) => void;
};

export const SimilarTrailBar: React.FC<Props> = ({
  similarPath,
  similarPreviewSrc,
  similarFilename,
  similarityOrder,
  trail,
  sourceRef,
  onSetSimilarityOrder,
  onTruncate,
}) => {
  const [pendingRemoveIdx, setPendingRemoveIdx] = useState<number | null>(null);
  const breadcrumbRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const breadcrumbPositionsRef = useRef<Record<string, DOMRect>>({});

  const breadcrumbEntries: BreadcrumbEntry[] = trail.map((item, idx, arr) => ({
    ...item,
    idx,
    key: `${item.path}::${
      arr.slice(0, idx).filter((candidate) => candidate.path === item.path)
        .length
    }`,
  }));

  useSafeLayoutEffect(() => {
    const nextPositions: Record<string, DOMRect> = {};

    const animateIntoPlace = (
      element: HTMLDivElement,
      startingTransform: string,
    ) => {
      element.style.transition = "none";
      element.style.transform = startingTransform;
      void element.getBoundingClientRect();

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          element.style.removeProperty("transition");
          element.style.removeProperty("transform");
        });
      });
    };

    breadcrumbEntries.forEach((entry) => {
      const element = breadcrumbRefs.current[entry.key];

      if (!element) {
        return;
      }

      const currentPosition = element.getBoundingClientRect();
      const previousPosition = breadcrumbPositionsRef.current[entry.key];

      nextPositions[entry.key] = currentPosition;

      if (!previousPosition) {
        animateIntoPlace(element, "translateX(-14px)");
        return;
      }

      const deltaX = previousPosition.left - currentPosition.left;

      if (Math.abs(deltaX) < 1) {
        return;
      }

      animateIntoPlace(element, `translateX(${deltaX}px)`);
    });

    breadcrumbPositionsRef.current = nextPositions;
  }, [breadcrumbEntries.map((entry) => entry.key).join("|")]);

  return (
    <div className={styles.modeBar}>
      <div className={styles.modeBarHeader}>
        <div className={styles.modeHeading}>
          <span className={styles.modeLabel}>Similar to</span>
          {similarFilename ? (
            <span className={styles.modeSimilarFilename}>{similarFilename}</span>
          ) : null}
        </div>
        <div className={styles.modeHeaderActions}>
          <Link href="/explore#visual-sameness" className={styles.similarityStatsLink}>
            <span>Visual sameness</span>
            <span aria-hidden="true">↗</span>
          </Link>
          <div
            className={styles.similarityOrderToggle}
            role="tablist"
            aria-label="Similarity order"
          >
            <button
              type="button"
              role="tab"
              aria-selected={similarityOrder === "most"}
              className={`${styles.similarityOrderButton}${similarityOrder === "most" ? ` ${styles.similarityOrderButtonActive}` : ""}`}
              onClick={() => {
                onSetSimilarityOrder("most");
              }}
            >
              Most similar
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={similarityOrder === "least"}
              className={`${styles.similarityOrderButton}${similarityOrder === "least" ? ` ${styles.similarityOrderButtonActive}` : ""}`}
              onClick={() => {
                onSetSimilarityOrder("least");
              }}
            >
              Least similar
            </button>
          </div>
        </div>
      </div>
      <div className={styles.modeStack}>
        <div className={styles.modeSource} ref={sourceRef}>
          <div
            className={styles.modeSourceItem}
            style={{
              opacity: pendingRemoveIdx !== null ? 0.15 : undefined,
              transition: "opacity 0.15s ease",
            }}
          >
            {similarPreviewSrc ? (
              <img
                className={styles.modeSourcePreview}
                src={similarPreviewSrc}
                alt={`Source photo ${similarFilename ?? ""}`}
              />
            ) : null}
            <a
              className={styles.modeSourceSlideshowButton}
              href={`/slideshow?mode=similar&seed=${encodeURIComponent(similarPath)}`}
              aria-label="Start similarity trail slideshow"
              title="Start similarity trail slideshow"
              onClick={(event) => {
                event.preventDefault();
                window.location.assign(
                  `/slideshow?mode=similar&seed=${encodeURIComponent(similarPath)}`,
                );
              }}
            >
              🖼️
            </a>
            <button
              type="button"
              className={styles.breadcrumbRemoveButton}
              onClick={() => {
                setPendingRemoveIdx(null);
                onTruncate(trail.length);
              }}
              onMouseEnter={() => setPendingRemoveIdx(0)}
              onMouseLeave={() => setPendingRemoveIdx(null)}
              aria-label="Clear current similarity selection"
              title="Clear similarity selection"
            >
              ×
            </button>
          </div>
          {trail.length > 0 ? (
            <div className={styles.modeArrow} aria-hidden="true">
              →
            </div>
          ) : null}
        </div>
        {trail.length > 0 ? (
          <div
            className={styles.breadcrumbs}
            aria-label="Similarity breadcrumbs"
          >
            {[...breadcrumbEntries].reverse().map((entry) => {
              const { path, idx, key, similarity } = entry;
              const label = path.split("/").at(-1) ?? path;
              const opacity = 0.35 + (0.55 * (idx + 1)) / trail.length;
              const similarityLabel =
                typeof similarity === "number"
                  ? `${Math.round(similarity * 100)}%`
                  : null;
              const wouldBeRemoved =
                pendingRemoveIdx !== null && idx >= pendingRemoveIdx;

              return (
                <div
                  key={key}
                  className={`${styles.breadcrumbItem}${wouldBeRemoved ? ` ${styles.breadcrumbItemWillRemove}` : ""}`}
                  style={{ opacity: wouldBeRemoved ? undefined : opacity }}
                  ref={(element) => {
                    breadcrumbRefs.current[key] = element;
                  }}
                >
                  <a
                    className={styles.breadcrumbButton}
                    href={getAlbumAnchorHref(path)}
                    title={`Open ${label}`}
                    aria-label={label}
                  >
                    <img
                      className={styles.breadcrumbPreview}
                      src={getResizedAlbumImageSrc(path)}
                      alt=""
                    />
                    {similarityLabel ? (
                      <span className={styles.breadcrumbSimilarity}>
                        {similarityLabel}
                      </span>
                    ) : null}
                  </a>
                  <button
                    type="button"
                    className={styles.breadcrumbRemoveButton}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setPendingRemoveIdx(null);
                      onTruncate(idx);
                    }}
                    onMouseEnter={() => setPendingRemoveIdx(idx)}
                    onMouseLeave={() => setPendingRemoveIdx(null)}
                    aria-label={`Remove ${label} from breadcrumbs`}
                    title={`Remove ${label} and newer selections`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
};
