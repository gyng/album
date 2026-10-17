import { Icon } from "../../components/ui/Icon";
import DynamicSearchWithCoi from "../../components/search/DynamicSearchWithCoi";
import { GlobalNav } from "../../components/GlobalNav";
import { useHydrated } from "../../components/useHydrated";
import { Footer, Heading } from "../../components/ui";
import { ProgressBar } from "../../components/ProgressBar";
import baseStyles from "../ScreenLayout.module.css";
import styles from "./SearchScreen.module.css";
import { useCallback, useMemo, useState } from "react";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd, formatPageTitle } from "../../lib/seo";
import commonStyles from "../../styles/common.module.css";
import { forceDocumentNavigation } from "../../components/search/searchUtils";
import type { SearchNavState } from "../../components/search/Search";
import { usePublicConfig } from "../../components/platform";

const SearchPage = () => {
  const { siteOrigin } = usePublicConfig();
  const [searchNavState, setSearchNavState] = useState<SearchNavState | null>(null);
  const isMounted = useHydrated();
  const handleNavStateChange = useCallback((state: SearchNavState) => {
    setSearchNavState(state);
  }, []);

  // The database/model download progress streams through onNavStateChange on
  // every tick, so SearchPage re-renders rapidly while loading. Derive the
  // nav's inputs as stable primitives and memoise the nav element so those
  // progress updates don't re-render — and visibly flicker — the dice button.
  const databaseReady = searchNavState?.databaseReady ?? false;
  const isRandomSimilarLoading = searchNavState?.isRandomSimilarLoading ?? false;
  const onStartRandomSimilarSlideshow = searchNavState?.onStartRandomSimilarSlideshow;

  const slideshowAction = useMemo(
    () =>
      isMounted ? (
        <button
          type="button"
          className={commonStyles.splitButtonSub}
          onClick={() => onStartRandomSimilarSlideshow?.()}
          disabled={!databaseReady || isRandomSimilarLoading}
          aria-label="Start a similar-photo slideshow from a random photo"
          title={
            isRandomSimilarLoading
              ? "Starting similarity slideshow…"
              : "Start a similar-photo slideshow from a random photo"
          }
        >
          {isRandomSimilarLoading ? "…" : <Icon kind="dice" />}
        </button>
      ) : undefined,
    [isMounted, databaseReady, isRandomSimilarLoading, onStartRandomSimilarSlideshow],
  );

  const globalNav = useMemo(
    () => (
      <GlobalNav
        currentPage="search"
        hasPadding={false}
        onMapClick={(event) => forceDocumentNavigation(event, "/map")}
        slideshowAction={slideshowAction}
      />
    ),
    [slideshowAction],
  );

  return (
    <>
      <Seo
        title={formatPageTitle("Search")}
        description="Search the photo archive by text, tags, and visual similarity."
        pathname="/search"
        noindex
        jsonLd={buildCollectionPageJsonLd(
          {
            name: formatPageTitle("Search"),
            description: "Search the photo archive by text, tags, and visual similarity.",
            pathname: "/search",
          },
          siteOrigin,
        )}
      />
      <main id="main-content" className={baseStyles.main}>
        {globalNav}

        {/* The database-download progress sits beside the title, in a track
            of its own, so the bar coming and going cannot move what is below. */}
        <div className={styles.searchHeadingRow}>
          <Heading level={1} as="h1">
            Search
          </Heading>
          {searchNavState?.loading ? (
            <ProgressBar
              progress={searchNavState.loading.progress}
              {...(searchNavState.loading.details
                ? { details: searchNavState.loading.details }
                : {})}
              activity={searchNavState.loading.activity}
            />
          ) : null}
        </div>
        {searchNavState?.randomExploreError ? (
          <p className={styles.inlineError}>{searchNavState.randomExploreError}</p>
        ) : null}
        {/* Reserves the widget's opening screen from the first paint, so its
            arrival cannot push the footer down (see the stylesheet). */}
        <div className={styles.widgetReservation}>
          <DynamicSearchWithCoi onNavStateChange={handleNavStateChange} />
        </div>
      </main>
      <Footer />
    </>
  );
};

export default SearchPage;
