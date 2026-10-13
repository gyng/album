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
  expect(result.current[0]).toEqual({ mode: "visible", prefill: "minimal", size: 3 });
  expect(JSON.parse(localStorage.getItem(gameSettingsStorageKey("cross"))!)).toEqual(
    result.current[0],
  );
});

it.each(["{", "null", "[]", "false"])(
  "falls back safely for malformed stored settings %s",
  (raw) => {
    localStorage.setItem(gameSettingsStorageKey("connections"), raw);
    const { result } = renderHook(() => useGameSettings("connections"));
    expect(result.current[0]).toEqual({ size: 4, detail: "broad", hints: true });
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
  expect(connections.result.current[0]).toEqual({ size: 6, detail: "specific", hints: true });
  expect(guess.result.current[0]).toEqual({ rounds: 5, timeLimit: null, region: "" });
});

it("restores after remount and keeps each game's preferences separate", () => {
  const first = renderHook(() => useGameSettings("cross"));
  act(() => first.result.current[1]({ mode: "visible", prefill: "none", size: 5 }));
  first.unmount();
  const restored = renderHook(() => useGameSettings("cross"));
  const other = renderHook(() => useGameSettings("connections"));
  expect(restored.result.current[0]).toEqual({ mode: "visible", prefill: "none", size: 5 });
  expect(other.result.current[0]).toEqual({ size: 4, detail: "broad", hints: true });
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
  expect(result.current[0]).toEqual({ mode: "mind" });
  act(() => result.current[1]({ mode: "discover" }));
  expect(result.current[0]).toEqual({ mode: "discover" });
});
