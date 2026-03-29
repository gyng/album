import Link from "next/link";
import React from "react";
import { Seo } from "../components/Seo";
import { buildCollectionPageJsonLd } from "../lib/seo";

import styles from "./404.module.css";

export default function FourOhFour() {
  return (
    <>
      <Seo
        title="Page Not Found | Snapshots"
        description="This page could not be found."
        pathname="/404"
        noindex
        jsonLd={buildCollectionPageJsonLd({
          name: "Page Not Found | Snapshots",
          description: "This page could not be found.",
          pathname: "/404",
        })}
      />
      <div className={styles.error}>
        <h1>🔥</h1>
        <Link href="/">404. Back to album list</Link>
      </div>
    </>
  );
}
