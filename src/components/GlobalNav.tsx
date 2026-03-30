import Link from "next/link";
import { Nav } from "./Nav";
import commonStyles from "../styles/common.module.css";

export type GlobalNavPage =
  | "home"
  | "search"
  | "timeline"
  | "map"
  | "slideshow"
  | "explore";

type Props = {
  currentPage?: GlobalNavPage;
  hasPadding?: boolean;
  /**
   * Replaces the default slideshow 🎲 button. Used by the Search page to wire
   * the random-similar-slideshow action into the database state.
   */
  slideshowAction?: React.ReactNode;
  /** Extra items appended after the standard set (e.g. album-scoped links). */
  extraItems?: React.ReactNode;
  /**
   * onClick for the Map link. Used by the Search page to force a full
   * document navigation (needed when COI headers are active).
   */
  onMapClick?: React.MouseEventHandler<HTMLAnchorElement>;
};

const cx = (...classes: (string | undefined | false)[]) =>
  classes.filter(Boolean).join(" ");

export const GlobalNav: React.FC<Props> = ({
  currentPage,
  hasPadding,
  slideshowAction,
  extraItems,
  onMapClick,
}) => {
  const current = (page: GlobalNavPage) =>
    currentPage === page ? commonStyles.navCurrent : undefined;

  return (
    <Nav
      hasPadding={hasPadding}
      isHome={currentPage === "home"}
      extraItems={
        <>
          <li>
            <Link
              href="/search"
              className={cx(commonStyles.button, current("search"))}
            >
              Search
            </Link>
          </li>
          <li>
            <Link
              href="/explore"
              className={cx(commonStyles.button, current("explore"))}
            >
              Explore
            </Link>
          </li>
          <li>
            <Link
              href="/map"
              prefetch={onMapClick ? false : undefined}
              className={cx(commonStyles.button, current("map"))}
              onClick={onMapClick}
            >
              Map
            </Link>
          </li>
          <li>
            <Link
              href="/timeline"
              className={cx(commonStyles.button, current("timeline"))}
            >
              Timeline
            </Link>
          </li>
          <li>
            <div className={commonStyles.splitButton}>
              <Link
                href="/slideshow"
                className={cx(
                  commonStyles.splitButtonMain,
                  currentPage === "slideshow" ? commonStyles.navCurrent : undefined,
                )}
              >
                Slideshow
              </Link>
              {slideshowAction ?? (
                <Link
                  href="/slideshow?mode=similar&random=1"
                  className={commonStyles.splitButtonSub}
                  aria-label="Start similarity slideshow for a random image"
                  title="Start similarity slideshow for a random image"
                >
                  🎲
                </Link>
              )}
            </div>
          </li>
          {extraItems}
        </>
      }
    />
  );
};
