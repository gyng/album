import { NextPage } from "next/types";
import { useCallback } from "react";
import { useRouter } from "next/router";
import { useDatabase } from "../../components/database/useDatabase";
import { ProgressBar } from "../../components/ProgressBar";
import { GlobalNav } from "../../components/GlobalNav";
import { GuessGame } from "../../components/guess/GuessGame";
import { GameSettings } from "../../components/guess/guessTypes";
import { Seo } from "../../components/Seo";
import styles from "./guess.module.css";

type PageProps = {};

const parseTimer = (value: string | string[] | undefined): number | null => {
  if (value === "15" || value === "30") return Number(value);
  return null;
};

const GuessPage: NextPage<PageProps> = () => {
  const router = useRouter();
  const [database, progress] = useDatabase();

  const seedFromUrl =
    typeof router.query.seed === "string" ? router.query.seed : undefined;
  const regionFromUrl =
    typeof router.query.region === "string" ? router.query.region : undefined;
  const isDaily = router.query.daily !== undefined;

  // When a seed or daily flag is in the URL, skip the lobby.
  const initialSettings: GameSettings | undefined = isDaily
    ? { rounds: 5, timeLimit: null, daily: true }
    : seedFromUrl
      ? {
          rounds: Math.min(
            20,
            Math.max(1, Number(router.query.rounds) || 5),
          ),
          timeLimit: parseTimer(router.query.timer),
          region: regionFromUrl,
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
        title="Guess Where | Snapshots"
        description={description}
        pathname={`/guess${seedFromUrl ? `?seed=${seedFromUrl}` : ""}`}
      />
      <main className={styles.page}>
        <GlobalNav currentPage="guess" />

        {!database ? (
          <div className={styles.loading}>
            <h1 className={styles.title}>Guess Where</h1>
            <p>Loading photo database&hellip;</p>
            <ProgressBar progress={progress} />
          </div>
        ) : (
          <GuessGame
            database={database}
            initialSettings={initialSettings}
            seed={seedFromUrl}
            onSeedGenerated={handleSeedGenerated}
          />
        )}
      </main>
    </>
  );
};

export default GuessPage;
