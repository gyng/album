import { NextPage } from "next/types";
import DynamicSearchWithCoi from "../../components/search/DynamicSearchWithCoi";
import { GlobalNav } from "../../components/GlobalNav";
import { Footer, Heading } from "../../components/ui";
import { ProgressBar } from "../../components/ProgressBar";
import baseStyles from "../Index.module.css";
import styles from "./search.module.css";
import React, { useCallback, useMemo, useState } from "react";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";
import commonStyles from "../../styles/common.module.css";
import { forceDocumentNavigation } from "../../components/search/searchUtils";
import type { SearchNavState } from "../../components/search/Search";

type PageProps = {};

const SearchPage: NextPage<PageProps> = (props) => {
  const [searchNavState, setSearchNavState] = useState<SearchNavState | null>(
    null,
  );
  const [isMounted, setIsMounted] = useState(false);
  const handleNavStateChange = useCallback((state: SearchNavState) => {
    setSearchNavState(state);
  }, []);

  React.useEffect(() => {

    setIsMounted(true);
  }, []);

  // The database/model download progress streams through onNavStateChange on
  // every tick, so SearchPage re-renders rapidly while loading. Derive the
  // nav's inputs as stable primitives and memoise the nav element so those
  // progress updates don't re-render — and visibly flicker — the dice button.
  const databaseReady = searchNavState?.databaseReady ?? false;
  const isRandomSimilarLoading =
    searchNavState?.isRandomSimilarLoading ?? false;
  const onStartRandomSimilarSlideshow =
    searchNavState?.onStartRandomSimilarSlideshow;

  const slideshowAction = useMemo(
    () =>
      isMounted ? (
        <button
          type="button"
          className={commonStyles.splitButtonSub}
          onClick={() => onStartRandomSimilarSlideshow?.()}
          disabled={!databaseReady || isRandomSimilarLoading}
          aria-label="Start similarity slideshow for a random image"
          title={
            isRandomSimilarLoading
              ? "Starting similarity slideshow…"
              : "Start similarity slideshow for a random image"
          }
        >
          {isRandomSimilarLoading ? "…" : "🎲"}
        </button>
      ) : undefined,
    [
      isMounted,
      databaseReady,
      isRandomSimilarLoading,
      onStartRandomSimilarSlideshow,
    ],
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
        title="Search | Snapshots"
        description="Search the photo archive by text, tags, and visual similarity."
        pathname="/search"
        noindex
        jsonLd={buildCollectionPageJsonLd({
          name: "Search | Snapshots",
          description:
            "Search the photo archive by text, tags, and visual similarity.",
          pathname: "/search",
        })}
      />
      <main className={baseStyles.main}>
        {globalNav}

        {/* The database-download progress sits beside the title so it never
            takes vertical space in the results flow or shifts content when it
            finishes and disappears. */}
        <div className={styles.searchHeadingRow}>
          <Heading level={1} as="h1">Search</Heading>
          {searchNavState?.loading ? (
            <ProgressBar
              progress={searchNavState.loading.progress}
              details={searchNavState.loading.details}
            />
          ) : null}
        </div>
        {searchNavState?.randomExploreError ? (
          <p className={styles.inlineError}>
            {searchNavState.randomExploreError}
          </p>
        ) : null}
        <DynamicSearchWithCoi onNavStateChange={handleNavStateChange} />
      </main>
      <Footer />
    </>
  );
};

export default SearchPage;
