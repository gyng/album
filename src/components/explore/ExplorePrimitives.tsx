import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import { AppLink as Link } from "../platform";
import React from "react";
import { buildSimilaritySearchHref } from "../../util/searchFacets";
import { Caption, Heading, OverlayButtonLink, Thumb } from "../ui";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExplorePrimitives.module.css";
import { formatCoverage } from "./exploreViewModel";

const styles = mergeCssModuleStyles(
  sharedStyles,
  localStyles,
  [
    "group",
    "groupActions",
    "groupAnchorLink",
    "groupAnchorMark",
    "groupDescription",
    "groupDeferredContent",
    "groupDeferredPlaceholder",
    "groupDeferredSummary",
    "groupGrid",
    "groupHeader",
    "groupTitleRow",
    "visualThumbSearchButton",
    "visualThumbWrap",
  ],
  ["visualThumbSearchButton"],
);

export const ExploreStatSection: React.FC<{
  facetId: string;
  title: string;
  coverage: number;
  children: React.ReactNode;
}> = ({ facetId, title, coverage, children }) => (
  <section className={[styles.section, facetId === "hour" ? styles.sectionWide : ""].join(" ")}>
    <div className={styles.sectionHeader}>
      <Heading level={2} as="h2">
        {title}
      </Heading>
      <Caption as="span">{formatCoverage(coverage)}</Caption>
    </div>
    {coverage === 0 ? (
      <Caption size="sm">No data available.</Caption>
    ) : (
      <div className={styles.bars}>{children}</div>
    )}
  </section>
);

export const ExploreStatGroup: React.FC<{
  id?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  deferContent?: boolean;
  deferredSummary?: React.ReactNode;
}> = ({ id, title, description, actions, children, deferContent = false, deferredSummary }) => {
  const deferredContentRef = React.useRef<HTMLDivElement | null>(null);
  const [isDeferredContentVisible, setIsDeferredContentVisible] = React.useState(!deferContent);

  React.useEffect(() => {
    if (!deferContent || isDeferredContentVisible) {
      return;
    }

    if (id && window.location.hash === `#${id}`) {
      setIsDeferredContentVisible(true);
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setIsDeferredContentVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setIsDeferredContentVisible(true);
        }
      },
      { rootMargin: "600px 0px" },
    );

    if (deferredContentRef.current) {
      observer.observe(deferredContentRef.current);
    }

    return () => observer.disconnect();
  }, [deferContent, id, isDeferredContentVisible]);

  return (
    <section id={id} className={styles.group}>
      <div className={styles.groupHeader}>
        <div className={styles.groupTitleRow}>
          <Heading level={1}>
            {id ? (
              <a href={`#${id}`} className={styles.groupAnchorLink}>
                <span>{title}</span>
                <span className={styles.groupAnchorMark} aria-hidden="true">
                  #
                </span>
              </a>
            ) : (
              title
            )}
          </Heading>
          {actions ? <div className={styles.groupActions}>{actions}</div> : null}
        </div>
        {description ? <p className={styles.groupDescription}>{description}</p> : null}
      </div>
      {deferContent && !isDeferredContentVisible && deferredSummary ? (
        <div className={styles.groupDeferredSummary}>{deferredSummary}</div>
      ) : null}
      {deferContent ? (
        <div
          ref={deferredContentRef}
          className={styles.groupDeferredContent}
          aria-busy={!isDeferredContentVisible}
        >
          {isDeferredContentVisible ? (
            <div className={styles.groupGrid}>{children}</div>
          ) : (
            <div className={styles.groupDeferredPlaceholder} aria-hidden="true" />
          )}
        </div>
      ) : (
        <div className={styles.groupGrid}>{children}</div>
      )}
    </section>
  );
};

export const VisualSimilarityThumb: React.FC<{
  photo: {
    path: string;
    src: string;
    href: string;
    label: string;
    swatch?: string;
  };
  className?: string;
  imageClassName?: string;
}> = ({ photo, className, imageClassName }) => (
  <div className={`${styles.visualThumbWrap} ${className ?? ""}`.trim()}>
    <Link href={photo.href} className={styles.visualThumbLink}>
      <Thumb
        src={photo.src}
        alt={photo.label}
        loading="lazy"
        className={`${styles.visualThumb} ${imageClassName ?? ""}`.trim()}
        {...(photo.swatch ? { style: { backgroundColor: photo.swatch } } : {})}
      />
    </Link>
    <OverlayButtonLink
      href={buildSimilaritySearchHref(photo.path)}
      className={styles.visualThumbSearchButton}
      aria-label={`Find photos semantically similar to ${photo.label}`}
      title="Open similarity search"
    >
      <span aria-hidden="true">🔍</span>
      <span>Similar</span>
      <span aria-hidden="true">↗</span>
    </OverlayButtonLink>
  </div>
);
