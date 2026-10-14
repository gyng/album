import { useCallback, useEffect, useState } from "react";
import { AppLink, useUrlSearchParams } from "../../components/platform";
import { useDatabase } from "../../components/database/useDatabase";
import { ProgressBar } from "../../components/ProgressBar";
import { GlobalNav } from "../../components/GlobalNav";
import { GuessGame } from "../../components/guess/GuessGame";
import type { GameSettings } from "../../components/guess/guessTypes";
import { useGameSettings } from "../../components/fun/useGameSettings";
import { readGameStats } from "../../components/fun/useGameStats";
import { guessPhotosFromParams } from "../../components/guess/guessPhotoLinks";
import { localDayKey } from "../../util/gameDaily";
import { Seo } from "../../components/Seo";
import { Button, Heading, buttonStyles } from "../../components/ui";
import styles from "./GuessScreen.module.css";
import { formatPageTitle } from "../../lib/seo";

const parseTimer = (value: string | undefined): number | null => {
  if (value === "15" || value === "30") return Number(value);
  return null;
};

const GuessScreen = () => {
  const {
    ready: urlReady,
    searchParams,
    getSearchParam,
    hasSearchParam,
    replaceSearchParams,
  } = useUrlSearchParams();
  const [database, progress, , databaseError, retryDatabase] = useDatabase();

  const seedFromUrl = getSearchParam("seed") ?? undefined;
  const regionFromUrl = getSearchParam("region") ?? undefined;
  const isDaily = hasSearchParam("daily");
  const photosFromUrl = guessPhotosFromParams(searchParams);
  // Stats live in this browser's storage, so they are read after mount: null
  // until then, and the page waits rather than starting a daily it then drops.
  const [dailyFinished, setDailyFinished] = useState<boolean | null>(null);
  useEffect(() => {
    setDailyFinished(Boolean(readGameStats("guess").dailies[localDayKey()]));
  }, []);
  const [preferences, , preferencesReady] = useGameSettings("guess");
  const roundsFromUrl = getSearchParam("rounds");
  const timerFromUrl = getSearchParam("timer");
  const settingsForSeed: GameSettings = {
    rounds:
      roundsFromUrl !== null
        ? Math.min(20, Math.max(1, Number(roundsFromUrl) || 5))
        : preferences.rounds,
    timeLimit: timerFromUrl !== null ? parseTimer(timerFromUrl) : preferences.timeLimit,
    ...((regionFromUrl ?? preferences.region)
      ? { region: regionFromUrl ?? preferences.region }
      : {}),
  };

  // When a seed, daily flag or named photographs are in the URL, skip the
  // lobby — except for a daily already finished today, whose result and share
  // action are in the lobby.
  const initialSettings: GameSettings | undefined = isDaily
    ? dailyFinished
      ? undefined
      : { rounds: 5, timeLimit: null, daily: true }
    : photosFromUrl.length
      ? { rounds: photosFromUrl.length, timeLimit: null, photos: photosFromUrl }
      : seedFromUrl
        ? settingsForSeed
        : undefined;

  // Through the platform port rather than the History API, so the renderer's
  // router keeps its own record of the URL it is showing.
  const handleSeedGenerated = useCallback(
    (seed: string, settings: GameSettings) => {
      const params = new URLSearchParams(searchParams);
      params.delete("photos");
      if (settings.daily) {
        params.set("daily", "");
        for (const field of ["seed", "rounds", "timer", "region"]) params.delete(field);
      } else {
        params.delete("daily");
        params.set("seed", seed);
        params.set("rounds", String(settings.rounds));
        params.set("timer", settings.timeLimit === null ? "off" : String(settings.timeLimit));
        params.set("region", settings.region ?? "");
      }
      replaceSearchParams(params);
    },
    [searchParams, replaceSearchParams],
  );

  const [active, setActive] = useState(false);
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
        pathname={`/fun/guess${seedFromUrl ? `?seed=${seedFromUrl}` : ""}`}
      />
      <main
        id="main-content"
        className={[styles.page, active ? styles.playing : ""].filter(Boolean).join(" ")}
      >
        <GlobalNav currentPage="guess" hasPadding={false} />

        {/* Without the error branch a missing database left this page showing a
            0% progress bar forever, which reads as a hang rather than as a
            gallery that simply has not been indexed yet. */}
        {databaseError ? (
          <div className={styles.loading} role="alert">
            <Heading level={1} as="h1" className={styles.title}>
              Guess Where
            </Heading>
            <p>The game photographs could not be loaded.</p>
            <Button onClick={() => retryDatabase()}>Try again</Button>
            <AppLink href="/fun" className={buttonStyles.base}>
              All games
            </AppLink>
          </div>
        ) : !database || !urlReady || !preferencesReady || dailyFinished === null ? (
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
            onActiveChange={setActive}
            {...(initialSettings ? { initialSettings } : {})}
            {...(seedFromUrl && !isDaily && !photosFromUrl.length ? { seed: seedFromUrl } : {})}
            onSeedGenerated={handleSeedGenerated}
          />
        )}
      </main>
    </>
  );
};

export default GuessScreen;
