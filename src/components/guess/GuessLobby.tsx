import React, { useCallback, useEffect, useState } from "react";
import { Database } from "@sqlite.org/sqlite-wasm";
import { Heading, Caption, Select, SegmentedToggle } from "../ui";
import { fetchGuessRegions, GuessRegionOption } from "../search/api";
import { GameSettings } from "./guessTypes";
import styles from "./GuessLobby.module.css";

type GuessLobbyProps = {
  database: Database;
  defaults: GameSettings;
  onStart: (settings: GameSettings) => void;
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

const timerValueToLimit = (v: TimerValue): number | null =>
  v === "off" ? null : Number(v);

const limitToTimerValue = (limit: number | null): TimerValue => {
  if (limit === 30) return "30";
  if (limit === 15) return "15";
  return "off";
};

export const GuessLobby: React.FC<GuessLobbyProps> = ({
  database,
  defaults,
  onStart,
}) => {
  const [regions, setRegions] = useState<GuessRegionOption[]>([]);
  const [totalPhotos, setTotalPhotos] = useState(0);
  const [region, setRegion] = useState(defaults.region ?? "");
  const [timer, setTimer] = useState<TimerValue>(
    limitToTimerValue(defaults.timeLimit),
  );
  const [rounds, setRounds] = useState(String(defaults.rounds));

  useEffect(() => {
    let cancelled = false;
    fetchGuessRegions({ database }).then((result) => {
      if (cancelled) return;
      setRegions(result);
      setTotalPhotos(result.reduce((sum, r) => sum + r.count, 0));
    });
    return () => {
      cancelled = true;
    };
  }, [database]);

  const selectedCount = region
    ? regions.find((r) => r.country === region)?.count ?? 0
    : totalPhotos;

  const handleStart = useCallback(() => {
    onStart({
      rounds: Number(rounds),
      timeLimit: timerValueToLimit(timer),
      region: region || undefined,
    });
  }, [onStart, rounds, timer, region]);

  // Enter/Space to start
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        // Don't fire if user is interacting with a select
        if ((event.target as HTMLElement)?.tagName === "SELECT") return;
        event.preventDefault();
        handleStart();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleStart]);

  return (
    <div className={styles.lobby}>
      <div className={styles.header}>
        <Heading level={1}>Guess Where</Heading>
        <Caption as="p">
          Guess where each photo was taken on the map
        </Caption>
      </div>

      <div className={styles.options}>
        <label className={styles.optionRow} style={{ animationDelay: "0.05s" }}>
          <span className={styles.optionLabel}>Region</span>
          <Select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
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

        <div className={styles.optionRow} style={{ animationDelay: "0.1s" }}>
          <span className={styles.optionLabel}>Timer</span>
          <SegmentedToggle
            options={TIMER_OPTIONS}
            value={timer}
            onChange={setTimer}
            ariaLabel="Timer per round"
          />
        </div>

        <div className={styles.optionRow} style={{ animationDelay: "0.15s" }}>
          <span className={styles.optionLabel}>Rounds</span>
          <SegmentedToggle
            options={ROUND_OPTIONS}
            value={rounds}
            onChange={setRounds}
            ariaLabel="Number of rounds"
          />
        </div>
      </div>

      {selectedCount > 0 ? (
        <Caption as="p" className={styles.photoCount}>
          {selectedCount.toLocaleString()} photos available
        </Caption>
      ) : null}

      <button className={styles.playButton} onClick={handleStart}>
        Play
        <kbd className={styles.kbd}>Enter</kbd>
      </button>
    </div>
  );
};
