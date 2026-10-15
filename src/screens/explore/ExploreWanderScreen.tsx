import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import { ExploreWander } from "../../components/explore/ExploreWander";
import { useUrlSearchParams } from "../../components/platform";
import { Footer, Heading } from "../../components/ui";
import { formatPageTitle } from "../../lib/seo";
import styles from "../../components/explore/ExploreShared.module.css";

export default function ExploreWanderScreen() {
  const { ready } = useUrlSearchParams();
  return (
    <div className={styles.page}>
      <Seo
        title={formatPageTitle("Wander")}
        description="Follow visual connections through the photo archive."
        pathname="/explore/wander"
        jsonLd={[]}
      />
      <main id="main-content" className={styles.main}>
        <GlobalNav currentPage="explore-wander" hasPadding={false} />
        <Heading level={1} as="h1">
          Wander
        </Heading>
        {ready ? <ExploreWander /> : null}
      </main>
      <Footer />
    </div>
  );
}
