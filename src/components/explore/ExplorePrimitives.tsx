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
    "groupDeferredPlaceholder",
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

// Matches the breakpoint the explore grid and ChartTooltip already switch on.
const NARROW_VIEWPORT_QUERY = "(max-width: 720px)";

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
  // Every group expanded makes the page ~61 screens tall on a 390px phone, so a
  // reader has to scroll the whole archive analysis to reach any one part of
  // it. Narrow viewports get the summary and a control instead.
  //
  // The collapse is applied from an effect rather than during render, so the
  // first client render matches the server's and hydration stays clean. (The
  // server sends no group content either way — every group on this page sets
  // `deferContent`, so its HTML is the summary and a placeholder.)
  const [isNarrowViewport, setIsNarrowViewport] = React.useState(false);
  const [isOpenedByReader, setIsOpenedByReader] = React.useState(false);
  const [isLinkedTarget, setIsLinkedTarget] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const sync = () => setIsNarrowViewport(query.matches);
    sync();

    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

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

  const isCollapsed = isNarrowViewport && !isOpenedByReader && !isLinkedTarget;

  React.useEffect(() => {
    // `isCollapsed` is a dependency because the observed element only exists
    // once the group is open: while collapsed the ref is null, so without this
    // the observer never attaches and an expanded group would sit on its
    // placeholder forever.
    if (!deferContent || isDeferredContentVisible || isCollapsed) {
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
  }, [deferContent, id, isDeferredContentVisible, isCollapsed]);

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
          {/* Scope filters and view switches act on the group's content, so a
              collapsed group must not offer them. */}
          {actions && !isCollapsed ? <div className={styles.groupActions}>{actions}</div> : null}
        </div>
        {description ? <p className={styles.groupDescription}>{description}</p> : null}
      </div>
      {(isCollapsed || (deferContent && !isDeferredContentVisible)) && deferredSummary ? (
        <div className={styles.groupDeferredSummary}>{deferredSummary}</div>
      ) : null}
      {isNarrowViewport ? (
        <PillButton
          className={styles.groupToggle}
          aria-expanded={!isCollapsed}
          {
            /* Only while the content is actually in the DOM — a collapsed group
              renders nothing, and pointing at a missing id is worse than
              leaving `aria-expanded` to speak for itself. */ ...(id && !isCollapsed
              ? { "aria-controls": `${id}-content` }
              : {})
          }
          onClick={() => setIsOpenedByReader((open) => !open)}
        >
          <span>
            {isCollapsed ? "Show" : "Hide"} {title}
          </span>
        </PillButton>
      ) : null}
      {isCollapsed ? null : deferContent ? (
        <div
          ref={deferredContentRef}
          {...(id ? { id: `${id}-content` } : {})}
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
        <div {...(id ? { id: `${id}-content` } : {})} className={styles.groupGrid}>
          {children}
        </div>
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
