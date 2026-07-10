import Link from "next/link";
import { buildSimilaritySearchHref } from "../../util/searchFacets";
import { Caption, Heading, OverlayButtonLink, Thumb } from "../ui";
import styles from "../../pages/explore/explore.module.css";
import { formatCoverage } from "./exploreViewModel";

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
}> = ({ id, title, description, actions, children }) => (
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
  };
  className?: string;
  imageClassName?: string;
}> = ({ photo, className, imageClassName }) => (
  <div className={`${styles.visualThumbWrap} ${className ?? ""}`.trim()}>
    <Link href={photo.href} className={styles.visualThumbLink}>
      <Thumb
        src={photo.src}
        alt={photo.label}
        className={`${styles.visualThumb} ${imageClassName ?? ""}`.trim()}
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
