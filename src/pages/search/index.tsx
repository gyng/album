import { NextPage } from "next/types";
import DynamicSearchWithCoi from "../../components/search/DynamicSearchWithCoi";
import { Nav } from "../../components/Nav";
import baseStyles from "../Index.module.css";
import { useEffect } from "react";
import React from "react";
import { fetchTags } from "../../components/search/api";

type PageProps = {};

const SearchPage: NextPage<PageProps> = (props) => {
  return (
    <main className={baseStyles.main}>
      <Nav isEditing={false} editable={false} />

      <h1>Search & Explore</h1>
      <DynamicSearchWithCoi />
    </main>
  );
};

export default SearchPage;
