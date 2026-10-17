import { Icon } from "../ui/Icon";
import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import { AppLink as Link } from "../platform";
import React from "react";
import { buildSimilaritySearchHref } from "../../util/searchFacets";
import { Caption, Heading, OverlayButtonLink, PillButton, Thumb } from "../ui";
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
    "groupDeferredSummary",
    "groupGrid",
    "groupHeader",
    "groupTitleRow",
    "groupToggle",
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
  /** Shown in place of `children` while the group is collapsed on a narrow
      viewport; hidden above the narrow breakpoint, where content always shows. */
  deferredSummary?: React.ReactNode;
}> = ({ id, title, description, actions, children, deferredSummary }) => {
  // The collapse is a stylesheet decision, not a mount decision: the content is
  // always in the DOM, and `@media (max-width: 720px)` in
  // ExplorePrimitives.module.css hides it unless the section carries
  // `data-opened` or `data-linked`. So the server HTML already holds every
  // group's content and the first client render matches it exactly — nothing
  // moves after hydration, and the two reasons a narrow group is open are
  // attributes rather than state.
  //
  // Why collapse at all: every group expanded makes the page ~61 screens tall
  // on a 390px phone, so a reader would have to scroll the whole archive
  // analysis to reach any one part of it. Narrow viewports get the summary and
  // a control instead.
  const [isOpenedByReader, setIsOpenedByReader] = React.useState(false);
  const [isLinkedTarget, setIsLinkedTarget] = React.useState(false);

  // A group the URL points at must never be collapsed, or the "Jump to" nav
  // would land the reader on a closed section and read as a broken link. The
  // hash usually changes *after* mount — that nav is same-page links — so this
  // has to keep listening rather than read the hash once.
  React.useEffect(() => {
    if (typeof window === "undefined" || !id) {
      return;
    }

    const sync = () => setIsLinkedTarget(window.location.hash === `#${id}`);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [id]);

  const isOpened = isOpenedByReader || isLinkedTarget;

  return (
    <section
      id={id}
      className={styles.group}
      data-opened={isOpenedByReader ? "true" : "false"}
      data-linked={isLinkedTarget ? "true" : "false"}
    >
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
          {/* Scope filters and view switches act on the group's content, so the
              stylesheet hides them as well while a group is collapsed. */}
          {actions ? <div className={styles.groupActions}>{actions}</div> : null}
        </div>
        {description ? <p className={styles.groupDescription}>{description}</p> : null}
      </div>
      {deferredSummary ? (
        <div className={styles.groupDeferredSummary}>{deferredSummary}</div>
      ) : null}
      {/* Rendered at every width so no element appears after hydration; the
          stylesheet hides it above the breakpoint, and toggling only changes
          its label and `aria-expanded`, never whether it is there. */}
      <PillButton
        size="compact"
        className={styles.groupToggle}
        aria-expanded={isOpened}
        {...(id ? { "aria-controls": `${id}-content` } : {})}
        onClick={() => setIsOpenedByReader((open) => !open)}
      >
        <span>
          {isOpened ? "Hide" : "Show"} {title}
        </span>
      </PillButton>
      <div {...(id ? { id: `${id}-content` } : {})} className={styles.groupDeferredContent}>
        <div className={styles.groupGrid}>{children}</div>
      </div>
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
      <span aria-hidden="true">
        <Icon kind="search" />
      </span>
      <span>Similar</span>
      <span aria-hidden="true">↗</span>
    </OverlayButtonLink>
  </div>
);
