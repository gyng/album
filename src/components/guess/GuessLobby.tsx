import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Database } from "@sqlite.org/sqlite-wasm";
import { Button, Caption, Heading, KeyHint, Select, SegmentedToggle } from "../ui";
import { fetchGuessRegions, GuessRegionOption } from "../search/api";
import { GameSettings } from "./guessTypes";
import { type GameShortcut, useGameShortcuts } from "../fun/useGameShortcuts";
import { GameIllustration } from "../fun/GameIllustration";
import { useGameSettings, type GameSettingsRegistry } from "../fun/useGameSettings";
import { useUrlSearchParams } from "../platform";
import { GameStatsLine, ShareResult, dailyShareText, useShareOrigin } from "../fun/GameRecord";
import { dailyNumber, localDayKey } from "../../util/gameDaily";
import type { GameStats } from "../../util/gameStats";
import styles from "./GuessLobby.module.css";

type GuessLobbyProps = {
  database: Database;
  defaults: GameSettings;
  onStart: (settings: GameSettings) => void;
  /** Shown as an inline error above the start buttons (e.g. after a failed load). */
  error?: string | null;
  /** The player's record; null until read after mount. */
  stats?: GameStats | null;
};

type TimerValue = "off" | "30" | "15";

const TIMER_OPTIONS: { value: TimerValue; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "30", label: "30 s" },
  { value: "15", label: "15 s" },
];

const ROUND_OPTIONS: { value: string; label: string }[] = [
  { value: "3", label: "3" },
  { value: "5", label: "5" },
  { value: "10", label: "10" },
];

const timerValueToLimit = (v: TimerValue): number | null => (v === "off" ? null : Number(v));

const limitToTimerValue = (limit: number | null): TimerValue => {
  if (limit === 30) return "30";
  if (limit === 15) return "15";
  return "off";
};

const NO_REGIONS: GuessRegionOption[] = [];

export const GuessLobby: React.FC<GuessLobbyProps> = ({
  database,
  defaults,
  onStart,
  error,
  stats = null,
}) => {
  const dailyDescriptionId = useId();
  const siteOrigin = useShareOrigin();
  const today = localDayKey();
  const todaysDaily = stats?.dailies[today];
  // The regions last fetched, and for which database: a new database keeps showing
  // the previous list until its own arrives, but does not count as loaded.
  const [fetched, setFetched] = useState<{
    database: typeof database;
    regions: GuessRegionOption[];
    totalPhotos: number;
    loaded: boolean;
  } | null>(null);
  const regions = fetched?.regions ?? NO_REGIONS;
  const totalPhotos = fetched?.totalPhotos ?? 0;
  const regionsLoaded = fetched?.database === database && fetched.loaded;
  const { getSearchParam } = useUrlSearchParams();
  const overrides: Partial<GameSettingsRegistry["guess"]> = {};
  if (defaults.region !== undefined) overrides.region = defaults.region;
  if (defaults.timeLimit === 15 || defaults.timeLimit === 30)
    overrides.timeLimit = defaults.timeLimit;
  if (defaults.rounds === 3 || defaults.rounds === 10) overrides.rounds = defaults.rounds;
  const urlRegion = getSearchParam("region");
  const urlTimer = getSearchParam("timer");
  const urlRounds = getSearchParam("rounds");
  if (urlRegion !== null) overrides.region = urlRegion;
  if (urlTimer === "off" || urlTimer === "0") overrides.timeLimit = null;
  else if (urlTimer === "15" || urlTimer === "30")
    overrides.timeLimit = Number(urlTimer) as 15 | 30;
  if (urlRounds === "3" || urlRounds === "5" || urlRounds === "10")
    overrides.rounds = Number(urlRounds) as 3 | 5 | 10;
  const [settings, setSettings] = useGameSettings("guess", overrides);
  const region = settings.region;
  const timer = limitToTimerValue(settings.timeLimit);
  const rounds = String(settings.rounds);

  useEffect(() => {
    let cancelled = false;
    void fetchGuessRegions({ database })
      .then((result) => {
        if (cancelled) return;
        setFetched({
          database,
          regions: result,
          totalPhotos: result.reduce((sum, r) => sum + r.count, 0),
          loaded: true,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFetched({ database, regions: [], totalPhotos: 0, loaded: false });
      });
    return () => {
      cancelled = true;
    };
  }, [database]);

  useEffect(() => {
    if (
      regionsLoaded &&
      settings.region &&
      !regions.some((option) => option.country === settings.region)
    ) {
      setSettings((previous) => ({ ...previous, region: "" }));
    }
  }, [regionsLoaded, regions, settings.region, setSettings]);

  const selectedCount = region
    ? (regions.find((r) => r.country === region)?.count ?? 0)
    : totalPhotos;

  const handleStart = useCallback(() => {
    onStart({
      rounds: Number(rounds),
      timeLimit: timerValueToLimit(timer),
      ...(region ? { region } : {}),
    });
  }, [onStart, rounds, timer, region]);

  const handleDaily = useCallback(() => {
    onStart({
      rounds: 5,
      timeLimit: null,
      daily: true,
    });
  }, [onStart]);

  // Enter/Space start the game. The shared hook leaves focused controls their
  // native activation, so tabbing to Daily/Timer/Rounds and pressing Enter does
  // what that control says, and ignores repeats, modifiers and open dialogs.
  const shortcuts = useMemo<GameShortcut[]>(
    () => [
      { key: "Enter", label: "Play", action: handleStart },
      { key: "Space", label: "Play", action: handleStart },
    ],
    [handleStart],
  );
  useGameShortcuts(shortcuts);

  return (
    <div className={styles.lobby}>
      <div className={styles.illustration}>
        <GameIllustration src="/fun/guess-where.avif" />
      </div>
      <div className={styles.header}>
        <Heading level={1} as="h1">
          Guess Where
        </Heading>
        <Caption as="p">Guess where each photo was taken on the map</Caption>
        <GameStatsLine stats={stats} wins={false} />
      </div>

      <div className={styles.options}>
        <label className={styles.optionRow}>
          <span className={styles.optionLabel}>Region</span>
          <Select
            value={region}
            onChange={(e) => setSettings((previous) => ({ ...previous, region: e.target.value }))}
            className={styles.regionSelect}
          >
            <option value="">Everywhere</option>
            {regions.map((r) => (
              <option key={r.country} value={r.country}>
                {r.country} ({r.count})
              </option>
            ))}
          </Select>
        </label>

        <div className={styles.optionRow}>
          <span className={styles.optionLabel}>Timer</span>
          <SegmentedToggle
            className={styles.optionControl}
            options={TIMER_OPTIONS}
            value={timer}
            onChange={(value) =>
              setSettings((previous) => ({
                ...previous,
                timeLimit: timerValueToLimit(value) as null | 15 | 30,
              }))
            }
            ariaLabel="Timer per round"
          />
        </div>

        <div className={styles.optionRow}>
          <span className={styles.optionLabel}>Rounds</span>
          <SegmentedToggle
            className={styles.optionControl}
            options={ROUND_OPTIONS}
            value={rounds}
            onChange={(value) =>
              setSettings((previous) => ({ ...previous, rounds: Number(value) as 3 | 5 | 10 }))
            }
            ariaLabel="Number of rounds"
          />
        </div>
      </div>

      {selectedCount > 0 ? (
        <Caption as="p" className={styles.photoCount}>
          {selectedCount.toLocaleString("en-GB")} photos available
        </Caption>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.buttonRow}>
        {todaysDaily ? (
          // Today's daily is done: its result is shared, not replayed.
          <div className={styles.dailyAction}>
            <div className={styles.dailyShare}>
              <ShareResult text={dailyShareText("guess", today, todaysDaily.summary, siteOrigin)} />
            </div>
            <Caption as="span" size="sm" className={styles.dailyDescription}>
              Daily #{dailyNumber(today)} · {todaysDaily.summary}
            </Caption>
          </div>
        ) : (
          <div className={styles.dailyAction}>
            <Button
              className={styles.dailyButton}
              aria-describedby={dailyDescriptionId}
              onClick={handleDaily}
            >
              Daily challenge
            </Button>
            <Caption
              id={dailyDescriptionId}
              as="span"
              size="sm"
              className={styles.dailyDescription}
            >
              Five rounds · same photos for everyone today
            </Caption>
          </div>
        )}
        <Button variant="primary" className={styles.playButton} onClick={handleStart}>
          Play
          <KeyHint>Enter</KeyHint>
        </Button>
      </div>
    </div>
  );
};
