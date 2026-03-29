import { NextPage } from "next/types";
import DynamicSearchWithCoi from "../../components/search/DynamicSearchWithCoi";
import { GlobalNav } from "../../components/GlobalNav";
import baseStyles from "../Index.module.css";
import React, { useCallback, useState } from "react";
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
  const handleNavStateChange = useCallback((state: SearchNavState) => {
    setSearchNavState(state);
  }, []);

  return (
    <>
      <Seo
        title="Search & Explore | Snapshots"
        description="Search the photo archive by text, tags, and visual similarity."
        pathname="/search"
        noindex
        jsonLd={buildCollectionPageJsonLd({
          name: "Search & Explore | Snapshots",
          description:
            "Search the photo archive by text, tags, and visual similarity.",
          pathname: "/search",
        })}
      />
      <main className={baseStyles.main}>
        <GlobalNav
          currentPage="search"
          hasPadding={false}
          onMapClick={(event) => forceDocumentNavigation(event, "/map")}
          slideshowAction={
            <button
              type="button"
              className={commonStyles.splitButtonSub}
              onClick={() => {
                searchNavState?.onStartRandomSimilarSlideshow();
              }}
              disabled={
                !searchNavState?.databaseReady ||
                searchNavState.isRandomSimilarLoading
              }
              aria-label="Start similarity slideshow for a random image"
              title={
                searchNavState?.isRandomSimilarLoading
                  ? "Starting similarity slideshow..."
                  : "Start similarity slideshow for a random image"
              }
            >
              {searchNavState?.isRandomSimilarLoading ? "…" : "🎲"}
            </button>
          }
        />

        <h1>Search & Explore</h1>
        {searchNavState?.randomExploreError ? (
          <p style={{ color: "var(--c-accent)", margin: 0 }}>
            {searchNavState.randomExploreError}
          </p>
        ) : null}
        <DynamicSearchWithCoi onNavStateChange={handleNavStateChange} />
      </main>
    </>
  );
};

export default SearchPage;
