import { GlobalNav } from "../../components/GlobalNav";
import { AppLink } from "../../components/platform";
import { Seo } from "../../components/Seo";
import { Heading } from "../../components/ui";
import { formatPageTitle } from "../../lib/seo";
import styles from "./FunChangelogScreen.module.css";

export default function FunChangelogScreen() {
  return (
    <main id="main-content" className={styles.page}>
      <Seo title={formatPageTitle("Game changelog")} pathname="/fun/changelog" jsonLd={[]} />
      <GlobalNav currentPage="fun" hasPadding={false} />
      <Heading level={1} as="h1">
        Game changelog
      </Heading>
      <section className={styles.entry} aria-labelledby="release-2026-11-11">
        <Heading level={2} as="h2">
          <time id="release-2026-11-11" dateTime="2026-11-11">
            11 November 2026
          </time>
        </Heading>
        <ul>
          <li>
            <AppLink href="/fun/double-take">Double Take</AppLink> has a daily: the same pairs for
            everyone, counted once.
          </li>
          <li>
            <AppLink href="/fun/guess">Guess Where</AppLink> plays a round dealt from a clip, with
            sound on request. Its countdown pauses while the page is hidden, and its daily and
            challenge links no longer depend on how the archive was indexed.
          </li>
          <li>
            Blind Frame no longer counts a second attempt at a scene whose original has been shown.
          </li>
        </ul>
      </section>
      <section className={styles.entry} aria-labelledby="release-2026-10-20">
        <Heading level={2} as="h2">
          <time id="release-2026-10-20" dateTime="2026-10-20">
            20 October 2026
          </time>
        </Heading>
        <ul>
          <li>
            Cross Exposure keeps the board in place when a hint places a photograph. Fixed
            photographs have an accented border instead of a badge over the image.
          </li>
        </ul>
      </section>
      <section className={styles.entry} aria-labelledby="release-2026-10-19">
        <Heading level={2} as="h2">
          <time id="release-2026-10-19" dateTime="2026-10-19">
            19 October 2026
          </time>
        </Heading>
        <ul>
          <li>
            <AppLink href="/fun/cross-exposure">Cross Exposure</AppLink> now checks partially filled
            grids in hidden-connections mode. Checks respect revealed clues and leave the round open
            until every photograph is placed correctly.
          </li>
        </ul>
      </section>
    </main>
  );
}
