import { Albums } from "../components/Albums";
import { Footer, Heading } from "../components/ui";
import styles from "./ScreenLayout.module.css";
import type { HomePageData } from "../util/pageDataTypes";
// import DynamicSearchWithCoi from "../components/search/DynamicSearchWithCoi";
import { Seo } from "../components/Seo";
import {
  SITE_NAME,
  buildCollectionPageJsonLd,
  buildWebSiteJsonLd,
  getDefaultSeo,
} from "../lib/seo";
import { GlobalNav } from "../components/GlobalNav";
import { usePublicConfig } from "../components/platform";

export type HomeScreenProps = HomePageData;

const HomeScreen = (context: HomeScreenProps) => {
  const { siteOrigin } = usePublicConfig();
  return (
    <div>
      <Seo
        jsonLd={[
          buildWebSiteJsonLd(siteOrigin),
          buildCollectionPageJsonLd(
            {
              name: SITE_NAME,
              description: getDefaultSeo().defaultDescription,
              pathname: "/",
            },
            siteOrigin,
          ),
        ]}
      />

      <main id="main-content" className={styles.main}>
        <GlobalNav currentPage="home" hasPadding={false} />
        <Heading level={1} as="h1">
          {SITE_NAME}
        </Heading>
        <Albums albums={context.albums} />
      </main>

      <Footer />
    </div>
  );
};

export default HomeScreen;
