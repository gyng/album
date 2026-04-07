import React, { useCallback, useEffect, useReducer, useState } from "react";
import dynamic from "next/dynamic";
import { Database } from "@sqlite.org/sqlite-wasm";
import { fetchGuessPhotos, RandomPhotoRow } from "../search/api";
import { extractGPSFromExifString } from "../../util/extractExifFromDb";
import { GuessRound, RoundResult } from "./GuessRound";
import { GuessSummary } from "./GuessSummary";
import { GuessLobby } from "./GuessLobby";
import { GameSettings, GuessPhoto } from "./guessTypes";
import styles from "./GuessGame.module.css";

const GuessMap = dynamic(() => import("./GuessMapExport"), {
  loading: () => null,
  ssr: false,
});

type GuessGameProps = {
  database: Database;
  initialSettings?: GameSettings;
  seed?: string;
  onSeedGenerated?: (seed: string) => void;
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
    const gps = extractGPSFromExifString(row.exif);
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
        phase:
          results.length >= state.photos.length ? "summary" : state.phase,
        currentRound:
          results.length >= state.photos.length
            ? state.currentRound
            : state.currentRound + 1,
      };
    }
    case "play_again":
      return {
        ...state,
        phase: "loading",
        photos: [],
        currentRound: 0,
        results: [],
        error: null,
        activeSeed: "",
        loadKey: state.loadKey + 1,
      };
    case "change_settings":
      return { ...state, phase: "lobby" };
    default:
      return state;
  }
};

export const GuessGame: React.FC<GuessGameProps> = ({
  database,
  initialSettings,
  seed: seedProp,
  onSeedGenerated,
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

  // Guess state lifted here so the map (rendered persistently) and round can share it
  const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
  const [revealed, setRevealed] = useState(false);

  // Fetch photos when entering loading phase
  useEffect(() => {
    if (state.phase !== "loading" || state.loadKey === 0) return;
    let cancelled = false;

    const load = async () => {
      const seed = seedProp || generateSeed();
      try {
        const rows = await fetchGuessPhotos({
          database,
          count: state.settings.rounds + 5,
          region: state.settings.region,
          seed,
        });
        if (cancelled) return;
        const parsed = parsePhotos(rows).slice(0, state.settings.rounds);

        if (parsed.length === 0) {
          dispatch({
            type: "error",
            message:
              "No GPS-tagged photos found. Try a different region.",
          });
          return;
        }

        dispatch({ type: "loaded", photos: parsed, seed });
        setGuess(null);
        setRevealed(false);
        onSeedGenerated?.(seed);
      } catch {
        if (cancelled) return;
        dispatch({
          type: "error",
          message: "Failed to load photos from the database.",
        });
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [database, state.phase, state.loadKey, state.settings, seedProp, onSeedGenerated]);

  const handleGuess = useCallback((lat: number, lng: number) => {
    setGuess({ lat, lng });
  }, []);

  const handleReveal = useCallback(() => {
    setRevealed(true);
  }, []);

  const handleStart = useCallback((settings: GameSettings) => {
    dispatch({ type: "start", settings });
  }, []);

  const handleRoundComplete = useCallback(
    (result: RoundResult) => {
      dispatch({ type: "round_complete", result });
      // Reset guess for next round
      setGuess(null);
      setRevealed(false);
    },
    [],
  );

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
        defaults={state.settings}
        onStart={handleStart}
      />
    );
  }

  if (state.phase === "loading") {
    return <p className={styles.status}>Loading photos&hellip;</p>;
  }

  if (state.error) {
    return <p className={styles.status}>{state.error}</p>;
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

  const photo = state.photos[state.currentRound];
  if (!photo) {
    return <p className={styles.status}>No more photos.</p>;
  }

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
        <GuessMap
          guess={guess}
          reveal={revealed ? { lat: photo.lat, lng: photo.lng } : undefined}
          onGuess={handleGuess}
        />
      }
    />
  );
};
