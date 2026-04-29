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
      <ul ref={ulRef} className={commonStyles.topBar}>
        <li>
          <Link
            href="/"
            className={[
              commonStyles.button,
              props.isHome ? commonStyles.navCurrent : "",
            ].join(" ")}
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
