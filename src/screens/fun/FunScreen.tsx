import { GlobalNav } from "../../components/GlobalNav";
import { AppLink } from "../../components/platform";
import { Heading, Icon } from "../../components/ui";
import { Seo } from "../../components/Seo";
import { formatPageTitle } from "../../lib/seo";
import { FUN_GAMES } from "../../components/fun/games";
import styles from "./FunScreen.module.css";

const FunScreen = () => (
  <main id="main-content" className={styles.page}>
    <Seo
      title={formatPageTitle("Fun")}
      description="Play with the photo archive: geography, visual connections, drawing and a photo oracle."
      pathname="/fun"
      jsonLd={[]}
    />
    <GlobalNav currentPage="fun" hasPadding={false} />
    <Heading level={1} as="h1">
      Fun
    </Heading>
    <div className={styles.games}>
      {FUN_GAMES.map((game, index) => (
        <AppLink key={game.id} href={game.href} className={styles.game}>
          <img
            className={styles.illustration}
            src={game.illustration}
            width={960}
            height={640}
            alt=""
            loading={index > 1 ? "lazy" : "eager"}
          />
          <div className={styles.gameBody}>
            <Heading level={1} as="h2">
              {game.title}
            </Heading>
            <p>{game.description}</p>
            <span className={styles.play}>
              Play <Icon kind="compass" />
            </span>
          </div>
        </AppLink>
      ))}
    </div>
  </main>
);

export default FunScreen;
