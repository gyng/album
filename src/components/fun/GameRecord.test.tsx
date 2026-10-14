/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { localDayKey } from "../../util/gameDaily";
import { EMPTY_GAME_STATS, recordGameResult } from "../../util/gameStats";
import {
  dailyPhotoOrder,
  dailyPuzzle,
  dailyShareText,
  GameStatsLine,
  ShareResult,
} from "./GameRecord";
import { gameStatsStorageKey, readGameStats, useGameStats } from "./useGameStats";

beforeEach(() => localStorage.clear());

describe("useGameStats", () => {
  it("records finished games and reads them back in another visit", () => {
    const { result } = renderHook(() => useGameStats("connections"));
    act(() => {
      result.current.record({ won: true, score: 5 });
    });
    expect(result.current.stats).toMatchObject({ played: 1, won: 1, best: 5 });
    expect(readGameStats("connections")).toMatchObject({ played: 1 });
    expect(readGameStats("hindsight")).toEqual(EMPTY_GAME_STATS);
  });

  it("keeps working when storage is unavailable", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() => useGameStats("connections"));
    act(() => {
      result.current.record({ won: false });
    });
    expect(result.current.stats).toMatchObject({ played: 1, won: 0 });
    jest.restoreAllMocks();
  });

  it("picks up games finished in another tab", () => {
    const { result } = renderHook(() => useGameStats("connections"));
    const elsewhere = recordGameResult(EMPTY_GAME_STATS, { won: true }, localDayKey());
    localStorage.setItem(gameStatsStorageKey("connections"), JSON.stringify(elsewhere));
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: gameStatsStorageKey("connections") }),
      );
    });
    expect(result.current.stats).toMatchObject({ played: 1 });
  });
});

describe("GameStatsLine", () => {
  it("says nothing before the first finished game", () => {
    const { container } = render(<GameStatsLine stats={EMPTY_GAME_STATS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("summarises play, wins, best score and a live streak", () => {
    const today = localDayKey();
    const yesterday = localDayKey(new Date(Date.now() - 86_400_000));
    let stats = recordGameResult(EMPTY_GAME_STATS, { won: true, score: 1200 }, yesterday);
    stats = recordGameResult(stats, { won: false, score: 900 }, today);
    render(<GameStatsLine stats={stats} />);
    expect(screen.getByText("Played 2 · won 1 · best 1,200 · 2-day streak")).toBeInTheDocument();
  });
});

describe("daily puzzles", () => {
  it("orders the archive the same way however it arrived", () => {
    const photos = [{ path: "b" }, { path: "c" }, { path: "a" }];
    expect(dailyPhotoOrder(photos).map((photo) => photo.path)).toEqual(["a", "b", "c"]);
    expect(dailyPhotoOrder([...photos].reverse())).toEqual(dailyPhotoOrder(photos));
  });

  it("rebuilds the same board from the same day", () => {
    const first = dailyPuzzle("connections", "2026-10-20");
    const a = first.random();
    const b = first.random();
    expect([a(), a()]).toEqual([b(), b()]);
    expect(first.number).toBe(7);
  });

  it("shares a title, number, summary and a link back to the daily", () => {
    expect(dailyShareText("connections", "2026-10-14", "1 mistake", "https://example.com")).toBe(
      "Connect the Shots #1\n1 mistake\nhttps://example.com/fun/connections?daily",
    );
  });
});

describe("ShareResult", () => {
  it("copies the text where there is no share sheet", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ShareResult text="Hindsight #1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share result" }));
    });
    expect(writeText).toHaveBeenCalledWith("Hindsight #1");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });
});
