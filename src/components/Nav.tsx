import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./Nav.module.css";
import commonStyles from "../styles/common.module.css";
import { ThemeToggle } from "./ThemeToggle";

export const Nav: React.FC<{
  albumName?: string;
  hasPadding?: boolean;
  extraItems?: React.ReactNode;
  isHome?: boolean;
}> = (props) => {
  const ulRef = useRef<HTMLUListElement>(null);
  // Whether the scrolling nav has hidden content beyond the left/right edges.
  // Drives the edge-fade overlays on .nav.
  const [hasMoreLeft, setHasMoreLeft] = useState(false);
  const [hasMoreRight, setHasMoreRight] = useState(false);

  useEffect(() => {
    const ul = ulRef.current;
    if (!ul) return;

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
  // current page is visible without scrolling. Honour reduced-motion for the
  // JS-driven smooth scroll.
  useEffect(() => {
    const ul = ulRef.current;
    if (!ul) return;
    const active = ul.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    active.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
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
      className={[
        styles.nav,
        hasMoreLeft ? styles.scrollableLeft : "",
        hasMoreRight ? styles.scrollableRight : "",
        props.hasPadding === false ? commonStyles.noNavPadding : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <a
        href="#main-content"
        className={styles.skipLink}
        onClick={skipToContent}
      >
        Skip to content
      </a>
      <ul ref={ulRef} className={commonStyles.topBar}>
        <li>
          <Link
            href="/"
            className={[
              commonStyles.button,
              props.isHome ? commonStyles.navCurrent : "",
            ].join(" ")}
            aria-current={props.isHome ? "page" : undefined}
          >
            Albums
          </Link>
        </li>
        {props.albumName ? (
          <>
            <li>
              <Link
                href={`/map?filter_album=${props.albumName}`}
                className={commonStyles.button}
              >
                Album map
              </Link>
            </li>
            <li>
              <Link
                href={`/timeline?filter_album=${props.albumName}`}
                className={commonStyles.button}
              >
                Album timeline
              </Link>
            </li>
            <li>
              <Link
                href={`/slideshow?filter=${props.albumName}`}
                className={commonStyles.button}
              >
                Album slideshow
              </Link>
            </li>
          </>
        ) : null}
        {props.extraItems}
        <li className={styles.themeToggleItem}>
          <ThemeToggle />
        </li>
      </ul>
    </nav>
  );
};
