/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuessSummary } from "./GuessSummary";
import { MAX_SCORE, MAX_TIME_BONUS } from "./guessScoring";
import type { RoundResult } from "./GuessRound";
import type { GameSettings, GuessPhoto } from "./guessTypes";

jest.mock("./useAnimatedCounter", () => ({
  useAnimatedCounter: (target: number) => (node: HTMLElement | null) => {
    if (node) node.textContent = target.toLocaleString();
  },
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const photo = (overrides: Partial<GuessPhoto> = {}): GuessPhoto => ({
  path: "/data/albums/test-simple/photo.jpg",
  albumName: "test-simple",
  photoName: "photo.jpg",
  lat: 35,
  lng: 139,
  geocode: "JP\nTokyo\nJapan",
  ...overrides,
});

const result = (score: number, overrides: Partial<RoundResult> = {}): RoundResult => ({
  photo: photo(),
  distanceMeters: 1_250,
  distanceScore: score,
  timeBonus: 0,
  score,
  skipped: false,
  ...overrides,
});

const renderSummary = (
  results: RoundResult[],
  settings: GameSettings = { rounds: 5, timeLimit: null },
) => {
  const onPlayAgain = jest.fn();
  const onChangeSettings = jest.fn();
  render(
    <GuessSummary
      results={results}
      seed="challenge-seed"
      settings={settings}
      onPlayAgain={onPlayAgain}
      onChangeSettings={onChangeSettings}
    />,
  );
  return { onPlayAgain, onChangeSettings };
};

describe("GuessSummary", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  it.each([
    [0.95, "Local expert"],
    [0.75, "Seasoned traveller"],
    [0.55, "Decent navigator"],
    [0.35, "Getting there"],
    [0.15, "Tourist with a broken compass"],
    [0.05, "Lost in space"],
  ])("rates a score at %s of the maximum", (ratio, rating) => {
    renderSummary([result(Math.round(MAX_SCORE * ratio))]);

    expect(screen.getByText(rating)).toBeInTheDocument();
  });

  it("summarises locations, skips, time bonuses, and action callbacks", () => {
    const timedMaximum = MAX_SCORE + MAX_TIME_BONUS;
    const first = result(timedMaximum, {
      distanceScore: MAX_SCORE,
      timeBonus: MAX_TIME_BONUS,
      photo: photo({ geocode: "JP\nTokyo\nJapan" }),
    });
    const second = result(0, {
      distanceMeters: Infinity,
      skipped: true,
      photo: photo({
        path: "/data/albums/test-simple/other.jpg",
        photoName: "other.jpg",
        geocode: "",
      }),
    });
    const { onPlayAgain, onChangeSettings } = renderSummary([first, second], {
      rounds: 2,
      timeLimit: 30,
    });

    expect(screen.getByText("Tokyo, Japan")).toBeInTheDocument();
    expect(screen.getByText("Unknown location")).toBeInTheDocument();
    expect(screen.getByText("1.3 km")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText(`+${MAX_TIME_BONUS.toLocaleString()}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    fireEvent.click(screen.getByRole("button", { name: "Change settings" }));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect(onChangeSettings).toHaveBeenCalledTimes(1);
  });

  it("builds and copies a challenge URL with non-default settings", async () => {
    renderSummary([result(1_000)], { rounds: 3, timeLimit: 15, region: "New Zealand" });

    fireEvent.click(screen.getByRole("button", { name: "Copy challenge link" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "http://localhost/guess?seed=challenge-seed&rounds=3&region=New+Zealand&timer=15",
    );
    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();

    act(() => jest.advanceTimersByTime(2_000));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy challenge link" })).toBeInTheDocument(),
    );
  });

  it("copies the canonical daily challenge URL", async () => {
    renderSummary([result(1_000)], { rounds: 5, timeLimit: null, daily: true });

    expect(screen.getByText("Daily challenge")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy challenge link" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("http://localhost/guess?daily");
    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("handles empty and minimal geocodes without inventing a location", () => {
    renderSummary([
      result(0, { photo: photo({ geocode: "   \n  " }) }),
      result(0, {
        photo: photo({
          path: "/data/albums/test-simple/single.jpg",
          photoName: "single.jpg",
          geocode: "Singapore",
        }),
      }),
    ]);

    expect(screen.getByText("Singapore")).toBeInTheDocument();
    expect(screen.getByText("Unknown location")).toBeInTheDocument();
  });

  it("renders a valid zero-score summary when there are no results", () => {
    renderSummary([]);

    expect(screen.getByText("Lost in space")).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeEmptyDOMElement();
  });
});
