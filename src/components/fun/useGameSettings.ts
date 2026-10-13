import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export type GameSettingsRegistry = {
  cross: { mode: "visible" | "hidden"; prefill: "none" | "minimal" | "guided"; size: 3 | 4 | 5 };
  connections: { size: 4 | 5 | 6; detail: "broad" | "specific"; hints: boolean };
  sightLines: { size: 5 | 6 };
  doubleTake: { slower: boolean };
  oracle: { mode: "mind" | "discover" };
  guess: { region: string; timeLimit: null | 15 | 30; rounds: 3 | 5 | 10 };
};

type Game = keyof GameSettingsRegistry;

const defaults: GameSettingsRegistry = {
  cross: { mode: "hidden", prefill: "minimal", size: 3 },
  connections: { size: 4, detail: "broad", hints: true },
  sightLines: { size: 5 },
  doubleTake: { slower: false },
  oracle: { mode: "mind" },
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
    prefill: oneOf("none", "minimal", "guided"),
    size: oneOf(3, 4, 5),
  },
  connections: { size: oneOf(4, 5, 6), detail: oneOf("broad", "specific"), hints: boolean },
  sightLines: { size: oneOf(5, 6) },
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
    const candidate = object[String(field)];
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
