import { AppLink as Link } from "./platform";
import { Nav } from "./Nav";
import commonStyles from "../styles/common.module.css";
import { buttonStyles } from "./ui";
import styles from "./GlobalNav.module.css";
import { ExploreSubnav } from "./explore/ExploreSubnav";

export type GlobalNavPage =
  | "home"
  | "search"
  | "timeline"
  | "map"
  | "slideshow"
  | "explore"
  | "trips"
  | "guess";

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
   * A control pinned to the trailing end of the row, outside the scrolling list.
   * The map's search field lives here: it stays on screen at every width, and the
   * scroller would clip the actions it hangs below itself.
   */
  trailingItem?: React.ReactNode;
  /** Shown just before the theme picker; the map's basemap picker uses it. */
  themeAdjacentItem?: React.ReactNode;
  /**
   * onClick for the Map link. Used by the Search page to force a full
   * document navigation (needed when COI headers are active).
   */
  onMapClick?: React.MouseEventHandler<HTMLAnchorElement>;
};

const cx = (...classes: (string | undefined | false)[]) => classes.filter(Boolean).join(" ");

export const GlobalNav: React.FC<Props> = ({
  currentPage,
  hasPadding,
  slideshowAction,
  extraItems,
  trailingItem,
  themeAdjacentItem,
  onMapClick,
}) => {
  const current = (page: GlobalNavPage) =>
    currentPage === page ? commonStyles.navCurrent : undefined;
  const ariaCurrent = (page: GlobalNavPage) => (currentPage === page ? "page" : undefined);
  const MapLink = onMapClick ? "a" : Link;

  const exploreView =
    currentPage === "explore" || currentPage === "timeline" || currentPage === "trips";
  return (
    <div className={styles.stack}>
      <Nav
        {...(hasPadding !== undefined ? { hasPadding } : {})}
        {...(trailingItem !== undefined ? { trailingItem } : {})}
        {...(themeAdjacentItem !== undefined ? { themeAdjacentItem } : {})}
        isHome={currentPage === "home"}
        extraItems={
          <>
            <li>
              <Link
                href="/search"
                className={cx(buttonStyles.base, current("search"))}
                aria-current={ariaCurrent("search")}
              >
                Search
              </Link>
            </li>
            <li>
              <Link
                href="/explore"
                className={cx(buttonStyles.base, exploreView && commonStyles.navCurrent)}
                aria-current={currentPage === "explore" ? "page" : exploreView ? "true" : undefined}
              >
                Explore
              </Link>
            </li>
            <li>
              <MapLink
                href="/map"
                className={cx(buttonStyles.base, current("map"))}
                onClick={onMapClick}
                aria-current={ariaCurrent("map")}
              >
                Map
              </MapLink>
            </li>
            <li>
              <div className={commonStyles.splitButton}>
                <Link
                  href="/slideshow/shell"
                  className={cx(
                    commonStyles.splitButtonMain,
                    currentPage === "slideshow" ? commonStyles.navCurrent : undefined,
                  )}
                  aria-current={ariaCurrent("slideshow")}
                >
                  Slideshow
                </Link>
                {slideshowAction ?? (
                  <Link
                    href="/slideshow/shell?mode=similar&random=1"
                    className={commonStyles.splitButtonSub}
                    aria-label="Start a similar-photo slideshow from a random photo"
                    title="Start a similar-photo slideshow from a random photo"
                  >
                    🎲
                  </Link>
                )}
              </div>
            </li>
            <li>
              <Link
                href="/guess"
                className={cx(buttonStyles.base, current("guess"))}
                aria-current={ariaCurrent("guess")}
              >
                Guess Where
              </Link>
            </li>
            {extraItems}
          </>
        }
      />
      {exploreView ? (
        <ExploreSubnav current={currentPage as "explore" | "timeline" | "trips"} />
      ) : null}
    </div>
  );
};
