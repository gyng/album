import { useCallback } from "react";
import { useUrlSearchParams } from "../../components/platform";
import { useDatabase } from "../../components/database/useDatabase";
import { ProgressBar } from "../../components/ProgressBar";
import { GlobalNav } from "../../components/GlobalNav";
import { GuessGame } from "../../components/guess/GuessGame";
import type { GameSettings } from "../../components/guess/guessTypes";
import { Seo } from "../../components/Seo";
import { Heading } from "../../components/ui";
import styles from "./GuessScreen.module.css";
import { formatPageTitle } from "../../lib/seo";

const parseTimer = (value: string | undefined): number | null => {
  if (value === "15" || value === "30") return Number(value);
  return null;
};

const GuessScreen = () => {
  const { ready: urlReady, getSearchParam, hasSearchParam } = useUrlSearchParams();
  const [database, progress, , databaseError, retryDatabase] = useDatabase();

  const seedFromUrl = getSearchParam("seed") ?? undefined;
  const regionFromUrl = getSearchParam("region") ?? undefined;
  const isDaily = hasSearchParam("daily");

  // When a seed or daily flag is in the URL, skip the lobby.
  const initialSettings: GameSettings | undefined = isDaily
    ? { rounds: 5, timeLimit: null, daily: true }
    : seedFromUrl
      ? {
          rounds: Math.min(20, Math.max(1, Number(getSearchParam("rounds")) || 5)),
          timeLimit: parseTimer(getSearchParam("timer") ?? undefined),
          ...(regionFromUrl ? { region: regionFromUrl } : {}),
        }
      : undefined;

  const handleSeedGenerated = useCallback(
    (seed: string) => {
      if (!seedFromUrl) {
        const params = new URLSearchParams(window.location.search);
        params.set("seed", seed);
        window.history.replaceState(null, "", `?${params.toString()}`);
      }
    },
    [seedFromUrl],
  );

  const isChallenge = Boolean(seedFromUrl) || isDaily;
  const description = isDaily
    ? "Today's daily challenge — guess where each photo was taken."
    : isChallenge
      ? "Can you beat this score? Guess where each photo was taken."
      : "Test your geography — guess where each photo was taken on the map.";

  return (
    <>
      <Seo
        title={formatPageTitle("Guess Where")}
        description={description}
        pathname={`/guess${seedFromUrl ? `?seed=${seedFromUrl}` : ""}`}
      />
      <main id="main-content" className={styles.page}>
        <GlobalNav currentPage="guess" hasPadding={false} />

        {/* Without the error branch a missing database left this page showing a
            0% progress bar forever, which reads as a hang rather than as a
            gallery that simply has not been indexed yet. */}
        {databaseError ? (
          <div className={styles.loading}>
            <Heading level={1} as="h1" className={styles.title}>
              Guess Where
            </Heading>
            <p>
              Couldn&apos;t load the photo database. This game needs a search index — run{" "}
              <code>album index</code> to build one.
            </p>
            <button type="button" onClick={() => retryDatabase()}>
              Try again
            </button>
          </div>
        ) : !database || !urlReady ? (
          <div className={styles.loading}>
            <Heading level={1} as="h1" className={styles.title}>
              Guess Where
            </Heading>
            <p>{database ? "Loading challenge…" : "Loading photo database…"}</p>
            <ProgressBar progress={progress} />
          </div>
        ) : (
          <GuessGame
            database={database}
            {...(initialSettings ? { initialSettings } : {})}
            {...(seedFromUrl ? { seed: seedFromUrl } : {})}
            onSeedGenerated={handleSeedGenerated}
          />
        )}
      </main>
    </>
  );
};

export default GuessScreen;
