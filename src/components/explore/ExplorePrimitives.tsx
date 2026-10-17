import { Icon } from "../ui/Icon";
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
      <Heading level={2} as="h3">
        {title}
      </Heading>
      {formatCoverage(coverage) ? <Caption as="span">{formatCoverage(coverage)}</Caption> : null}
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
}> = ({ id, title, description, actions, children }) => (
  // Every group renders its content in the server HTML at every width, so the
  // first paint is the final layout: nothing is mounted, collapsed or expanded
  // after hydration.
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
    <div className={styles.groupGrid}>{children}</div>
  </section>
);

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
      <span aria-hidden="true">
        <Icon kind="search" />
      </span>
      <span>Similar</span>
      <span aria-hidden="true">↗</span>
    </OverlayButtonLink>
  </div>
);
