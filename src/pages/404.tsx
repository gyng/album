import Link from "next/link";
import { GlobalNav } from "../components/GlobalNav";
import { Seo } from "../components/Seo";
import { buildCollectionPageJsonLd } from "../lib/seo";

import styles from "./404.module.css";

export default function FourOhFour() {
  return (
    <div className={styles.page}>
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
      <GlobalNav />
      <main className={styles.error}>
        <span className={styles.glyph} aria-hidden="true">
          🔥
        </span>
        <h1 className={styles.heading}>404 — page not found</h1>
        <Link href="/" className={styles.homeLink}>
          Back to album list
        </Link>
      </main>
    </div>
  );
}
