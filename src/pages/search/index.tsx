import { NextPage } from "next/types";
import DynamicSearchWithCoi from "../../components/search/DynamicSearchWithCoi";
import { Nav } from "../../components/Nav";
import baseStyles from "../Index.module.css";
import React from "react";

type PageProps = {};

const SearchPage: NextPage<PageProps> = (props) => {
  return (
    <main className={baseStyles.main}>
      <Nav isEditing={false} editable={false} hasPadding={false} />

      <h1>Search & Explore</h1>
      <DynamicSearchWithCoi />
    </main>
  );
};

export default SearchPage;
