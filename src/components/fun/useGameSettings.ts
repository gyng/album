import type { PhotoSearchSize, PhotoSearchLineLength } from "../../util/photoWordSearch";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export type GameSettingsRegistry = {
  cross: { mode: "visible" | "hidden"; prefill: 0 | 1 | 2 | 3 | 4; size: 3 | 4 | 5 };
  connections: {
    size: 4 | 5 | 6;
    detail: "broad" | "specific";
    hints: boolean;
    lives: null | 4 | 6 | 8;
  };
  sightLines: { size: PhotoSearchSize; lineLength: PhotoSearchLineLength };
  doubleTake: { slower: boolean };
  oracle: { mode: "mind" | "discover" };
  guess: { region: string; timeLimit: null | 15 | 30; rounds: 3 | 5 | 10 };
};

type Game = keyof GameSettingsRegistry;

const defaults: GameSettingsRegistry = {
  cross: { mode: "hidden", prefill: 0, size: 3 },
  connections: { size: 4, detail: "broad", hints: true, lives: null },
  sightLines: { size: 5, lineLength: 3 },
  doubleTake: { slower: false },
  oracle: { mode: "discover" },
  guess: { region: "", timeLimit: null, rounds: 5 },
};

const oneOf =
  <T extends string | number | null>(...values: T[]) =>
  (value: unknown): value is T =>
    values.some((candidate) => candidate === value);
const boolean = (value: unknown): value is boolean => typeof value === "boolean";

const validators: {
  [G in Game]: {
    [K in keyof GameSettingsRegistry[G]]: (value: unknown) => value is GameSettingsRegistry[G][K];
  };
} = {
  cross: {
    mode: oneOf("visible", "hidden"),
    prefill: oneOf(0, 1, 2, 3, 4),
    size: oneOf(3, 4, 5),
  },
  connections: {
    size: oneOf(4, 5, 6),
    detail: oneOf("broad", "specific"),
    hints: boolean,
    lives: oneOf(null, 4, 6, 8),
  },
  sightLines: { size: oneOf(5, 6, 7, 8, 9, 10), lineLength: oneOf(3, 4, 5) },
  doubleTake: { slower: boolean },
  oracle: { mode: oneOf("mind", "discover") },
  guess: {
    region: (value): value is string =>
      typeof value === "string" && value.length <= 128 && !value.includes("\0"),
    timeLimit: oneOf(null, 15, 30),
    rounds: oneOf(3, 5, 10),
  },
};

export const gameSettingsStorageKey = (game: Game): string => `snapshots-fun-settings-v1:${game}`;

const validFields = <G extends Game>(game: G, value: unknown): Partial<GameSettingsRegistry[G]> => {
  const fields: Partial<GameSettingsRegistry[G]> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return fields;
  const object = value as Record<string, unknown>;
  for (const field of Object.keys(defaults[game]) as Array<keyof GameSettingsRegistry[G]>) {
    let candidate = object[String(field)];
    if (game === "cross" && field === "prefill" && typeof candidate === "string")
      candidate = ({ none: 0, minimal: 1, guided: 4 } as Record<string, number>)[candidate];
    if (validators[game][field](candidate))
      fields[field] = candidate as GameSettingsRegistry[G][typeof field];
  }
  return fields;
};

/** Lobby preferences only. Initial overrides (such as explicit URL fields) win over saved values.
 * Read after hydration so the server and first client render agree; write only after that read. */
export const useGameSettings = <G extends Game>(
  game: G,
  initialOverrides?: Partial<GameSettingsRegistry[G]>,
): [GameSettingsRegistry[G], Dispatch<SetStateAction<GameSettingsRegistry[G]>>, boolean] => {
  const overridesRef = useRef(initialOverrides);
  const [settings, setSettings] = useState<GameSettingsRegistry[G]>(() => ({
    ...defaults[game],
    ...validFields(game, initialOverrides),
  }));
  const [loadedGame, setLoadedGame] = useState<Game | null>(null);
  useEffect(() => {
    let saved: unknown;
    try {
      const raw = window.localStorage.getItem(gameSettingsStorageKey(game));
      if (raw) saved = JSON.parse(raw);
    } catch {
      /* Preferences still work when storage is blocked or malformed. */
    }
    setSettings({
      ...defaults[game],
      ...validFields(game, saved),
      ...validFields(game, overridesRef.current),
    });
    setLoadedGame(game);
  }, [game]);
  useEffect(() => {
    if (loadedGame !== game) return;
    try {
      window.localStorage.setItem(gameSettingsStorageKey(game), JSON.stringify(settings));
    } catch {
      /* Saving preferences is best-effort. */
    }
  }, [game, loadedGame, settings]);
  return [settings, setSettings, loadedGame === game];
};
