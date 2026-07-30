import { AppLink as Link } from "../components/platform";
import { GlobalNav } from "../components/GlobalNav";
import { Seo } from "../components/Seo";
import { Heading } from "../components/ui";
import { buildCollectionPageJsonLd, formatPageTitle } from "../lib/seo";
import { usePublicConfig } from "../components/platform";

import styles from "./FourOhFourScreen.module.css";

export default function FourOhFourScreen() {
  const { siteOrigin } = usePublicConfig();
  return (
    <div className={styles.page}>
      <Seo
        title={formatPageTitle("Page Not Found")}
        description="This page could not be found."
        pathname="/404"
        noindex
        jsonLd={buildCollectionPageJsonLd(
          {
            name: formatPageTitle("Page Not Found"),
            description: "This page could not be found.",
            pathname: "/404",
          },
          siteOrigin,
        )}
      />
      <GlobalNav />
      <main id="main-content" className={styles.error}>
        <span className={styles.glyph} aria-hidden="true">
          🔥
        </span>
        <Heading level={1} as="h1" className={styles.heading}>
          404 — page not found
        </Heading>
        <Link href="/" className={styles.homeLink}>
          Back to album list
        </Link>
      </main>
    </div>
  );
}
