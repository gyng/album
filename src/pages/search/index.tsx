import { NextPage } from "next/types";
import DynamicSearchWithCoi from "../../components/search/DynamicSearchWithCoi";
import { Nav } from "../../components/Nav";
import baseStyles from "../Index.module.css";
import React from "react";
import { Seo } from "../../components/Seo";
import { buildCollectionPageJsonLd } from "../../lib/seo";

type PageProps = {};

const SearchPage: NextPage<PageProps> = (props) => {
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
        <Nav hasPadding={false} />

        <h1>Search & Explore</h1>
        <DynamicSearchWithCoi />
      </main>
    </>
  );
};

export default SearchPage;
