import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import { Heading } from "../../components/ui";
import { useUrlSearchParams } from "../../components/platform";
import { WanderGame } from "../../components/fun/WanderGame";
import { formatPageTitle } from "../../lib/seo";
import styles from "./PhotoGameScreen.module.css";

export const WanderScreen = () => {
  const { ready, getSearchParam } = useUrlSearchParams();
  const mode = getSearchParam("mode");
  return (
    <main id="main-content" className={styles.page}>
      <Seo
        title={formatPageTitle("Wander")}
        description="Follow photographic trails, find hidden subjects, or wander without a destination."
        pathname="/fun/wander"
        jsonLd={[]}
      />
      <GlobalNav currentPage="wander" hasPadding={false} />
      <header className={styles.header}>
        <Heading level={1} as="h1">
          Wander
        </Heading>
      </header>
      <div className={styles.content}>
        {ready ? (
          <WanderGame
            {...(mode === "quest" || mode === "roam" || mode === "hunt" || mode === "photos"
              ? { linkedMode: mode }
              : {})}
          />
        ) : null}
      </div>
    </main>
  );
};
