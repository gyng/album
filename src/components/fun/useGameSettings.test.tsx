/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { gameSettingsStorageKey, useGameSettings } from "./useGameSettings";

beforeEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
});

it("restores each valid field, rejects malformed fields and discards session data", () => {
  localStorage.setItem(
    gameSettingsStorageKey("cross"),
    JSON.stringify({
      mode: "visible",
      prefill: "lots",
      size: "5",
      cells: ["secret-photo"],
    }),
  );
  const { result } = renderHook(() => useGameSettings("cross"));
  expect(result.current[0]).toEqual({ mode: "visible", prefill: 0, size: 3 });
  expect(JSON.parse(localStorage.getItem(gameSettingsStorageKey("cross"))!)).toEqual(
    result.current[0],
  );
});

it.each(["{", "null", "[]", "false"])(
  "falls back safely for malformed stored settings %s",
  (raw) => {
    localStorage.setItem(gameSettingsStorageKey("connections"), raw);
    const { result } = renderHook(() => useGameSettings("connections"));
    expect(result.current[0]).toEqual({ size: 4, detail: "broad", hints: true, lives: null });
  },
);

it("validates booleans and allowed timers and round counts rather than coercing them", () => {
  localStorage.setItem(
    gameSettingsStorageKey("connections"),
    JSON.stringify({ size: 6, detail: "specific", hints: "false" }),
  );
  localStorage.setItem(
    gameSettingsStorageKey("guess"),
    JSON.stringify({ rounds: 999, timeLimit: 60, region: 4 }),
  );
  const connections = renderHook(() => useGameSettings("connections"));
  const guess = renderHook(() => useGameSettings("guess"));
  expect(connections.result.current[0]).toEqual({
    size: 6,
    detail: "specific",
    hints: true,
    lives: null,
  });
  expect(guess.result.current[0]).toEqual({ rounds: 5, timeLimit: null, region: "" });
});

it("restores after remount and keeps each game's preferences separate", () => {
  const first = renderHook(() => useGameSettings("cross"));
  act(() => first.result.current[1]({ mode: "visible", prefill: 0, size: 5 }));
  first.unmount();
  const restored = renderHook(() => useGameSettings("cross"));
  const other = renderHook(() => useGameSettings("connections"));
  expect(restored.result.current[0]).toEqual({ mode: "visible", prefill: 0, size: 5 });
  expect(other.result.current[0]).toEqual({ size: 4, detail: "broad", hints: true, lives: null });
});

it("applies only supplied initial overrides and allows later user changes", () => {
  localStorage.setItem(
    gameSettingsStorageKey("guess"),
    JSON.stringify({ rounds: 10, timeLimit: 30, region: "France" }),
  );
  const { result } = renderHook(() => useGameSettings("guess", { timeLimit: null }));
  expect(result.current[0]).toEqual({ rounds: 10, timeLimit: null, region: "France" });
  act(() => result.current[1]((previous) => ({ ...previous, timeLimit: 15 })));
  expect(result.current[0].timeLimit).toBe(15);
});

it("does not save values a link supplied until the player changes them", () => {
  const saved = { rounds: 10, timeLimit: 30, region: "France" };
  localStorage.setItem(gameSettingsStorageKey("guess"), JSON.stringify(saved));
  const stored = () => JSON.parse(localStorage.getItem(gameSettingsStorageKey("guess"))!);
  const { result } = renderHook(() => useGameSettings("guess", { region: "Japan", rounds: 3 }));
  expect(result.current[0]).toEqual({ rounds: 3, timeLimit: 30, region: "Japan" });
  expect(stored()).toEqual(saved);
  act(() => result.current[1]((previous) => ({ ...previous, timeLimit: 15 })));
  expect(stored()).toEqual({ ...saved, timeLimit: 15 });
  act(() => result.current[1]((previous) => ({ ...previous, rounds: 5 })));
  act(() => result.current[1]((previous) => ({ ...previous, rounds: 3 })));
  expect(stored()).toEqual({ ...saved, timeLimit: 15, rounds: 3 });
});

it("keeps a linked value out of a first visit's saved preferences", () => {
  const { result } = renderHook(() => useGameSettings("guess", { region: "Japan" }));
  expect(result.current[0].region).toBe("Japan");
  expect(JSON.parse(localStorage.getItem(gameSettingsStorageKey("guess"))!).region).toBe("");
});

it("does not read storage while rendering or overwrite a saved choice with defaults before loading", () => {
  localStorage.setItem(gameSettingsStorageKey("doubleTake"), JSON.stringify({ slower: true }));
  const get = jest.spyOn(Storage.prototype, "getItem");
  const set = jest.spyOn(Storage.prototype, "setItem");
  const Server = () => {
    const [settings] = useGameSettings("doubleTake");
    return <span>{String(settings.slower)}</span>;
  };
  expect(renderToString(<Server />)).toContain("false");
  expect(get).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
  const { result } = renderHook(() => useGameSettings("doubleTake"));
  expect(result.current[0].slower).toBe(true);
  expect(set.mock.calls.every(([, value]) => JSON.parse(String(value)).slower === true)).toBe(true);
});

it("keeps controls working when both reading and writing storage are blocked", () => {
  jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const { result } = renderHook(() => useGameSettings("oracle"));
  expect(result.current[0]).toEqual({ mode: "discover" });
  act(() => result.current[1]({ mode: "discover" }));
  expect(result.current[0]).toEqual({ mode: "discover" });
});

it("restores the largest Sight Lines board and longer line difficulty, rejecting out-of-range settings", () => {
  localStorage.setItem(
    gameSettingsStorageKey("sightLines"),
    JSON.stringify({ size: 10, lineLength: 5 }),
  );
  const game = renderHook(() => useGameSettings("sightLines"));
  expect(game.result.current[0]).toEqual({ size: 10, lineLength: 5 });
  game.unmount();
  localStorage.setItem(
    gameSettingsStorageKey("sightLines"),
    JSON.stringify({ size: 11, lineLength: 9 }),
  );
  expect(renderHook(() => useGameSettings("sightLines")).result.current[0]).toEqual({
    size: 5,
    lineLength: 3,
  });
});

it("migrates old Cross Exposure prefill labels to numeric counts", () => {
  localStorage.setItem(gameSettingsStorageKey("cross"), JSON.stringify({ prefill: "guided" }));
  expect(renderHook(() => useGameSettings("cross")).result.current[0].prefill).toBe(4);
});

it("starts new jigsaws in the piece-pool mode and migrates the old default", () => {
  localStorage.setItem(
    "snapshots-fun-settings-v1:jigsaw",
    JSON.stringify({ size: 4, mode: "swap" }),
  );
  const { result } = renderHook(() => useGameSettings("jigsaw"));
  expect(result.current[0]).toEqual({ size: 4, mode: "pool" });
  act(() => result.current[1]({ ...result.current[0], mode: "swap" }));
  expect(JSON.parse(localStorage.getItem(gameSettingsStorageKey("jigsaw"))!).mode).toBe("swap");
});
