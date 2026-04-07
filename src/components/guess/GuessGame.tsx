import React, { useCallback, useEffect, useReducer } from "react";
import { Database } from "@sqlite.org/sqlite-wasm";
import { fetchGuessPhotos, RandomPhotoRow } from "../search/api";
import { extractGPSFromExifString } from "../../util/extractExifFromDb";
import { GuessRound, RoundResult } from "./GuessRound";
import { GuessSummary } from "./GuessSummary";
import { GuessPhoto } from "./guessTypes";
import styles from "./GuessGame.module.css";

type Difficulty = "easy" | "medium" | "hard";

type GuessGameProps = {
  database: Database;
  rounds: number;
  filter?: string;
  difficulty: Difficulty;
};

const parsePhotos = (rows: RandomPhotoRow[]): GuessPhoto[] =>
  rows.flatMap((row) => {
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

type State = {
  photos: GuessPhoto[];
  currentRound: number;
  results: RoundResult[];
  error: string | null;
  /** Incremented to restart the game. The effect uses this as a dependency. */
  gameKey: number;
  /** Set to true once the first fetch resolves. */
  ready: boolean;
};

type Action =
  | { type: "loaded"; photos: GuessPhoto[] }
  | { type: "error"; message: string }
  | { type: "round_complete"; result: RoundResult }
  | { type: "play_again" };

const initialState: State = {
  photos: [],
  currentRound: 0,
  results: [],
  error: null,
  gameKey: 0,
  ready: false,
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        photos: action.photos,
        currentRound: 0,
        results: [],
        error: null,
        ready: true,
      };
    case "error":
      return { ...state, error: action.message, ready: true };
    case "round_complete": {
      const results = [...state.results, action.result];
      return {
        ...state,
        results,
        currentRound:
          results.length >= state.photos.length
            ? state.currentRound
            : state.currentRound + 1,
      };
    }
    case "play_again":
      return { ...initialState, gameKey: state.gameKey + 1 };
    default:
      return state;
  }
};

export const GuessGame: React.FC<GuessGameProps> = ({
  database,
  rounds,
  filter,
  difficulty,
}) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await fetchGuessPhotos({
          database,
          count: rounds + 5,
          filter,
        });
        if (cancelled) return;
        const parsed = parsePhotos(rows).slice(0, rounds);

        if (parsed.length === 0) {
          dispatch({
            type: "error",
            message:
              "No GPS-tagged photos found. Try a different album filter.",
          });
          return;
        }

        dispatch({ type: "loaded", photos: parsed });
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
  }, [database, rounds, filter, state.gameKey]);

  const handleRoundComplete = useCallback((result: RoundResult) => {
    dispatch({ type: "round_complete", result });
  }, []);

  const handlePlayAgain = useCallback(() => {
    dispatch({ type: "play_again" });
  }, []);

  if (!state.ready) {
    return <p className={styles.status}>Loading photos&hellip;</p>;
  }

  if (state.error) {
    return <p className={styles.status}>{state.error}</p>;
  }

  const isSummary = state.results.length >= state.photos.length;
  if (isSummary) {
    return (
      <GuessSummary results={state.results} onPlayAgain={handlePlayAgain} />
    );
  }

  const photo = state.photos[state.currentRound];
  if (!photo) {
    return <p className={styles.status}>No more photos.</p>;
  }

  const cumulativeScore = state.results.reduce((sum, r) => sum + r.score, 0);

  return (
    <GuessRound
      key={photo.path}
      photo={photo}
      roundNumber={state.currentRound + 1}
      totalRounds={state.photos.length}
      cumulativeScore={cumulativeScore}
      difficulty={difficulty}
      onComplete={handleRoundComplete}
    />
  );
};
