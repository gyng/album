import { AppLink as Link } from "./platform";
import { useEffect, useRef, useState } from "react";
import { useNavPositionMotion } from "./useNavPositionMotion";
import styles from "./Nav.module.css";
import commonStyles from "../styles/common.module.css";
import { ThemeToggle } from "./ThemeToggle";
import { buttonStyles } from "./ui";

export const Nav: React.FC<{
  albumName?: string;
  hasPadding?: boolean;
  extraItems?: React.ReactNode;
  /**
   * A control pinned to the trailing end of the nav row, outside the scrolling
   * list — for something that has to stay reachable at every width, or that
   * needs to hang content below the row.
   */
  trailingItem?: React.ReactNode;
  /**
   * A control shown immediately before the theme picker — another
   * page-appearance choice, and the map's basemap picker is one.
   */
  themeAdjacentItem?: React.ReactNode;
  isHome?: boolean;
}> = (props) => {
  const navRef = useRef<HTMLElement>(null);
  useNavPositionMotion(navRef);
  const ulRef = useRef<HTMLUListElement>(null);
  // Whether the scrolling nav has hidden content beyond the left/right edges.
  // Drives the edge-fade overlays on .nav.
  const [hasMoreLeft, setHasMoreLeft] = useState(false);
  const [hasMoreRight, setHasMoreRight] = useState(false);

  useEffect(() => {
    // The list is rendered unconditionally, so React has assigned this ref
    // before either mount effect runs.
    const ul = ulRef.current!;

    const update = () => {
      setHasMoreLeft(ul.scrollLeft > 0);
      setHasMoreRight(ul.scrollLeft + ul.clientWidth < ul.scrollWidth - 1);
    };

    update();
    ul.addEventListener("scroll", update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(ul);

    return () => {
      ul.removeEventListener("scroll", update);
      resizeObserver.disconnect();
    };
  }, []);

  // On narrow viewports the nav is a horizontal scroller; the active pill can
  // start off-screen (e.g. "Map" on /map). Bring it into view on mount so the
  // current page is visible without scrolling. An animated mount-time reveal
  // can be interrupted by focus moving into the page, leaving the pill clipped.
  useEffect(() => {
    const ul = ulRef.current!;
    const active = ul.querySelector<HTMLElement>('[aria-current="page"], [aria-current="true"]');
    if (!active) return;
    let cancelled = false;
    const reveal = () => {
      if (cancelled) return;
      active.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "auto" });
    };
    reveal();
    // Theme fonts can change both pill widths and the pinned picker's width.
    void document.fonts?.ready.then(reveal);
    return () => {
      cancelled = true;
    };
  }, []);

  const skipToContent: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
    const main = document.querySelector("main");
    if (!main) return;
    event.preventDefault();
    main.setAttribute("tabindex", "-1");
    main.focus();
    main.scrollIntoView();
  };

  return (
    <nav
      ref={navRef}
      className={[
        styles.nav,
        hasMoreLeft ? styles.scrollableLeft : "",
        hasMoreRight ? styles.scrollableRight : "",
        props.hasPadding === false ? styles.noPadding : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <a href="#main-content" className={styles.skipLink} onClick={skipToContent}>
        Skip to content
      </a>
      <div
        className={[styles.navRow, props.trailingItem ? styles.navRowWithTrailing : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <ul ref={ulRef} className={commonStyles.topBar}>
          <li>
            <Link
              href="/"
              className={[buttonStyles.base, props.isHome ? commonStyles.navCurrent : ""].join(" ")}
              aria-current={props.isHome ? "page" : undefined}
            >
              Albums
            </Link>
          </li>
          {props.albumName ? (
            <>
              <li aria-hidden="true" className={commonStyles.navDivider} />
              <li>
                <Link
                  href={`/map?${new URLSearchParams({ filter_album: props.albumName })}`}
                  className={`${buttonStyles.base} ${commonStyles.navContext}`}
                >
                  Album map
                </Link>
              </li>
              <li>
                <Link
                  href={`/explore/timeline?${new URLSearchParams({ filter_album: props.albumName })}`}
                  className={`${buttonStyles.base} ${commonStyles.navContext}`}
                >
                  Album timeline
                </Link>
              </li>
              <li>
                <Link
                  href={`/slideshow/shell?${new URLSearchParams({ filter: props.albumName })}`}
                  className={`${buttonStyles.base} ${commonStyles.navContext}`}
                >
                  Album slideshow
                </Link>
              </li>
            </>
          ) : null}
          {props.extraItems}
          {/* The same pair as the pinned group below, for narrow viewports: a
              second appearance picker beside the theme's is wider than a
              phone's nav row, so pinned they wrapped to a band of their own.
              The breakpoint in the stylesheet shows one copy or the other. */}
          {props.themeAdjacentItem ? (
            <li className={styles.appearanceInList}>
              <div className={styles.appearanceGroup}>
                {props.themeAdjacentItem}
                <ThemeToggle />
              </div>
            </li>
          ) : null}
        </ul>
        {/* Outside the scrolling list, like the theme toggle: a control put here
            stays on screen at every width, and — because nothing on this side of
            the row clips — it can hang content below itself. The list cannot: it
            is a horizontal scroller, so `overflow-y` is hidden and anything
            escaping the row is invisible and untappable. */}
        {props.trailingItem ? (
          <div className={styles.trailingItem}>{props.trailingItem}</div>
        ) : null}
        <div
          className={[
            styles.themeToggleItem,
            styles.appearanceGroup,
            props.themeAdjacentItem ? styles.themeToggleItemPair : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {props.themeAdjacentItem}
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
};
