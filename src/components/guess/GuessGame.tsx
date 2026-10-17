import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Database } from "@sqlite.org/sqlite-wasm";
import { fetchGuessPhotos, RandomPhotoRow } from "../search/api";
import { extractGPSFromExifString } from "../../util/extractExifFromDb";
import { GuessRound, RoundResult } from "./GuessRound";
import { GuessSummary } from "./GuessSummary";
import { GuessLobby } from "./GuessLobby";
import { GameSettings, GuessPhoto } from "./guessTypes";
import styles from "./GuessGame.module.css";
import { GuessMapDeferred } from "./GuessMapDeferred";
import { guessDailySeed, guessDailySeedDay } from "./guessDaily";
import { guessGameTotals } from "./guessScoring";
import { useGameStats } from "../fun/useGameStats";
import { GUESS_PHOTO_LIMIT } from "./guessPhotoLinks";

type GuessGameProps = {
  database: Database;
  initialSettings?: GameSettings;
  seed?: string;
  onSeedGenerated?: (seed: string, settings: GameSettings) => void;
  onActiveChange?: (active: boolean) => void;
};

const generateSeed = (): string => Math.random().toString(36).slice(2, 8);

const DEFAULT_SETTINGS: GameSettings = {
  rounds: 5,
  timeLimit: null,
};

const parsePhotos = (rows: RandomPhotoRow[]): GuessPhoto[] => {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (seen.has(row.path)) return [];
    seen.add(row.path);
    // A photograph's place is in its EXIF; a clip's only in the index's
    // metadata, which the query returns for every placed row.
    const gps =
      extractGPSFromExifString(row.exif) ??
      (row.latDeg !== undefined && row.lngDeg !== undefined
        ? ([row.latDeg, row.lngDeg] as const)
        : null);
    if (!gps) return [];
    const albumName = row.path.split("/")?.[2] ?? "";
    const photoName = row.path.split("/")?.[3] ?? "";
    if (!albumName || !photoName) return [];
    return [
      {
        path: row.path,
        lat: gps[0],
        lng: gps[1],
        geocode: row.geocode,
        albumName,
        photoName,
      },
    ];
  });
};

type Phase = "lobby" | "loading" | "playing" | "summary";

type State = {
  phase: Phase;
  settings: GameSettings;
  photos: GuessPhoto[];
  currentRound: number;
  results: RoundResult[];
  error: string | null;
  activeSeed: string;
  loadKey: number;
};

type Action =
  | { type: "start"; settings: GameSettings }
  | { type: "loaded"; photos: GuessPhoto[]; seed: string }
  | { type: "error"; message: string }
  | { type: "round_complete"; result: RoundResult }
  | { type: "play_again" }
  | { type: "change_settings" };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "start":
      return {
        ...state,
        phase: "loading",
        settings: action.settings,
        photos: [],
        currentRound: 0,
        results: [],
        error: null,
        loadKey: state.loadKey + 1,
      };
    case "loaded":
      return {
        ...state,
        phase: "playing",
        photos: action.photos,
        currentRound: 0,
        results: [],
        error: null,
        activeSeed: action.seed,
      };
    case "error":
      return { ...state, phase: "lobby", error: action.message };
    case "round_complete": {
      const results = [...state.results, action.result];
      return {
        ...state,
        results,
        phase: results.length >= state.photos.length ? "summary" : state.phase,
        currentRound:
          results.length >= state.photos.length ? state.currentRound : state.currentRound + 1,
      };
    }
    case "play_again": {
      // Replaying today's daily or a set of named photographs would deal the
      // same photographs again, so a replay is an ordinary practice game with
      // the same number of rounds.
      const { daily: _daily, photos: _photos, ...settings } = state.settings;
      return {
        ...state,
        settings,
        phase: "loading",
        photos: [],
        currentRound: 0,
        results: [],
        error: null,
        activeSeed: "",
        loadKey: state.loadKey + 1,
      };
    }
    case "change_settings":
      return { ...state, phase: "lobby" };
  }
};

export const GuessGame: React.FC<GuessGameProps> = ({
  database,
  initialSettings,
  seed: seedProp,
  onSeedGenerated,
  onActiveChange,
}) => {
  const skipLobby = Boolean(initialSettings);

  const [state, dispatch] = useReducer(reducer, {
    phase: skipLobby ? "loading" : "lobby",
    settings: initialSettings ?? DEFAULT_SETTINGS,
    photos: [],
    currentRound: 0,
    results: [],
    error: null,
    activeSeed: "",
    loadKey: skipLobby ? 1 : 0,
  });

  useEffect(() => {
    onActiveChange?.(state.phase !== "lobby");
  }, [state.phase, onActiveChange]);

  const { stats, record } = useGameStats("guess");
  // Each dealt game has its own load key, so a summary is recorded once
  // however often it renders (or StrictMode re-runs its effects).
  const recordedLoad = useRef(0);
  useEffect(() => {
    if (state.phase !== "summary" || recordedLoad.current === state.loadKey) return;
    recordedLoad.current = state.loadKey;
    const { total, summary } = guessGameTotals(
      state.results.map((result) => result.score),
      state.settings.timeLimit,
    );
    const day = state.settings.daily ? guessDailySeedDay(state.activeSeed) : null;
    record({ won: false, score: total, ...(day ? { daily: { day, summary } } : {}) });
  }, [state.phase, state.loadKey, state.results, state.settings, state.activeSeed, record]);

  // Guess state lifted here so the map (rendered persistently) and round can share it
  const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
  const [revealed, setRevealed] = useState(false);

  // Held in a ref so a renderer that recreates the callback when the URL it
  // writes changes cannot re-run (or cancel) a load.
  const onSeedGeneratedRef = useRef(onSeedGenerated);
  useEffect(() => {
    onSeedGeneratedRef.current = onSeedGenerated;
  }, [onSeedGenerated]);

  // Fetch photos when entering loading phase
  useEffect(() => {
    if (state.phase !== "loading" || state.loadKey === 0) return;
    let cancelled = false;

    const load = async () => {
      // A shared seed deals only the first game (load 1); Play again and a new
      // start from the lobby deal fresh photographs.
      const sharedSeed = state.loadKey === 1 ? seedProp : undefined;
      const named = state.settings.photos;
      const seed = named
        ? ""
        : sharedSeed || (state.settings.daily ? guessDailySeed() : generateSeed());
      try {
        const rows = named
          ? await fetchGuessPhotos({ database, count: GUESS_PHOTO_LIMIT, paths: named })
          : await fetchGuessPhotos({
              database,
              count: state.settings.rounds + 5,
              ...(state.settings.region ? { region: state.settings.region } : {}),
              seed,
            });
        if (cancelled) return;
        const parsed = parsePhotos(rows).slice(0, state.settings.rounds);

        if (parsed.length === 0) {
          dispatch({
            type: "error",
            message: named
              ? "None of these photographs has a recorded location."
              : "No GPS-tagged photos found. Try a different region.",
          });
          return;
        }

        dispatch({ type: "loaded", photos: parsed, seed });
        setGuess(null);
        setRevealed(false);
        // Named photographs are their own link; there is no seed to share.
        if (!named) onSeedGeneratedRef.current?.(seed, state.settings);
      } catch {
        if (cancelled) return;
        dispatch({
          type: "error",
          message: "Failed to load photos from the database.",
        });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [database, state.phase, state.loadKey, state.settings, seedProp]);

  const handleGuess = useCallback((lat: number, lng: number) => {
    setGuess({ lat, lng });
  }, []);

  const handleReveal = useCallback(() => {
    setRevealed(true);
  }, []);

  const handleStart = useCallback((settings: GameSettings) => {
    dispatch({ type: "start", settings });
  }, []);

  const handleRoundComplete = useCallback((result: RoundResult) => {
    dispatch({ type: "round_complete", result });
    // Reset guess for next round
    setGuess(null);
    setRevealed(false);
  }, []);

  const handlePlayAgain = useCallback(() => {
    dispatch({ type: "play_again" });
  }, []);

  const handleChangeSettings = useCallback(() => {
    dispatch({ type: "change_settings" });
  }, []);

  if (state.phase === "lobby") {
    return (
      <GuessLobby
        database={database}
        stats={stats}
        defaults={state.settings}
        onStart={handleStart}
        error={state.error}
      />
    );
  }

  if (state.phase === "loading") {
    return <p className={styles.status}>Loading photos&hellip;</p>;
  }

  if (state.phase === "summary") {
    return (
      <GuessSummary
        results={state.results}
        seed={state.activeSeed}
        settings={state.settings}
        onPlayAgain={handlePlayAgain}
        onChangeSettings={handleChangeSettings}
      />
    );
  }

  // The reducer enters playing only with a non-empty parsed photo list and
  // advances to summary before currentRound can exceed that list.
  const photo = state.photos[state.currentRound]!;

  const cumulativeScore = state.results.reduce((sum, r) => sum + r.score, 0);

  return (
    <GuessRound
      photo={photo}
      roundNumber={state.currentRound + 1}
      totalRounds={state.photos.length}
      cumulativeScore={cumulativeScore}
      timeLimit={state.settings.timeLimit}
      guess={guess}
      onComplete={handleRoundComplete}
      onReveal={handleReveal}
      onAbort={handleChangeSettings}
      mapSlot={
        <GuessMapDeferred
          guess={guess}
          {...(revealed ? { reveal: { lat: photo.lat, lng: photo.lng } } : {})}
          onGuess={handleGuess}
        />
      }
    />
  );
};
