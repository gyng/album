import { NextPage } from "next/types";
import DynamicSearchWithCoi from "../../components/search/DynamicSearchWithCoi";
import { Nav } from "../../components/Nav";
import baseStyles from "../Index.module.css";
import React, { useCallback, useState } from "react";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";
import Link from "next/link";
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
        <Nav
          hasPadding={false}
          extraItems={
            <>
              <li>
                <Link
                  href="/search"
                  className={[commonStyles.button, commonStyles.navCurrent].join(
                    " ",
                  )}
                >
                  Search & Explore
                </Link>
              </li>
              <li>
                <Link href="/timeline" className={commonStyles.button}>
                  Timeline
                </Link>
              </li>
              <li>
                <Link
                  href="/map"
                  prefetch={false}
                  className={commonStyles.button}
                  onClick={(event) => {
                    forceDocumentNavigation(event, "/map");
                  }}
                >
                  Map
                </Link>
              </li>
              <li>
                <div className={commonStyles.splitButton}>
                  <Link href="/slideshow" className={commonStyles.splitButtonMain}>
                    Slideshow
                  </Link>
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
                </div>
              </li>
            </>
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
