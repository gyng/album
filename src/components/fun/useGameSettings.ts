import type { PhotoSearchSize, PhotoSearchLineLength } from "../../util/photoWordSearch";
import type { HindsightSize, HindsightSpread } from "../../util/hindsight";
import type { WarmerLevel } from "../../util/semanticGames";
import type { CaptionBudget, CaptionMode } from "../../util/captionModes";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export type GameSettingsRegistry = {
  pairs: { mode: "visual" | "semantic"; pairs: 4 | 6 | 8; twist: "classic" | "glimpse" | "moving" };
  jigsaw: { size: 3 | 4 | 5; mode: "swap" | "rotate" | "slide" };
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
  hindsight: { size: HindsightSize; spread: HindsightSpread };
  warmer: { level: WarmerLevel };
  caption: { mode: CaptionMode; words: CaptionBudget; banned: boolean };
};

type Game = keyof GameSettingsRegistry;

const defaults: GameSettingsRegistry = {
  pairs: { mode: "visual", pairs: 6, twist: "classic" },
  jigsaw: { size: 3, mode: "swap" },
  cross: { mode: "hidden", prefill: 0, size: 3 },
  connections: { size: 4, detail: "broad", hints: true, lives: null },
  sightLines: { size: 5, lineLength: 3 },
  doubleTake: { slower: false },
  oracle: { mode: "discover" },
  guess: { region: "", timeLimit: null, rounds: 5 },
  hindsight: { size: 5, spread: "years" },
  warmer: { level: "normal" },
  caption: { mode: "single", words: null, banned: false },
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
  pairs: {
    mode: oneOf("visual", "semantic"),
    pairs: oneOf(4, 6, 8),
    twist: oneOf("classic", "glimpse", "moving"),
  },
  jigsaw: { size: oneOf(3, 4, 5), mode: oneOf("swap", "rotate", "slide") },
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
  hindsight: { size: oneOf(4, 5, 6), spread: oneOf("years", "trip") },
  warmer: { level: oneOf("normal", "hard") },
  caption: {
    mode: oneOf("single", "lookalikes", "set"),
    words: oneOf(null, 12, 8, 5),
    banned: boolean,
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

/** Lobby preferences only. Initial overrides (such as explicit URL fields) win over saved values
 * but are not saved themselves: a shared link must not replace the player's own choices. A field
 * the player changes afterwards is saved as usual.
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
  const savedRef = useRef<GameSettingsRegistry[G]>(defaults[game]);
  const linkedRef = useRef<Partial<GameSettingsRegistry[G]>>({});
  useEffect(() => {
    let saved: unknown;
    try {
      const raw = window.localStorage.getItem(gameSettingsStorageKey(game));
      if (raw) saved = JSON.parse(raw);
    } catch {
      /* Preferences still work when storage is blocked or malformed. */
    }
    const overrides = validFields(game, overridesRef.current);
    savedRef.current = { ...defaults[game], ...validFields(game, saved) };
    linkedRef.current = overrides;
    setSettings({ ...savedRef.current, ...overrides });
    setLoadedGame(game);
  }, [game]);
  useEffect(() => {
    if (loadedGame !== game) return;
    const persisted = { ...settings };
    const linked = linkedRef.current;
    for (const field of Object.keys(linked) as Array<keyof GameSettingsRegistry[G]>) {
      // Once the player moves a linked field, it is theirs and saved from then on.
      if (settings[field] !== linked[field]) delete linked[field];
      else persisted[field] = savedRef.current[field];
    }
    try {
      window.localStorage.setItem(gameSettingsStorageKey(game), JSON.stringify(persisted));
    } catch {
      /* Saving preferences is best-effort. */
    }
  }, [game, loadedGame, settings]);
  return [settings, setSettings, loadedGame === game];
};
