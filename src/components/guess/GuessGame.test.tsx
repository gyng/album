/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetchGuessPhotos } from "../search/api";
import { extractGPSFromExifString } from "../../util/extractExifFromDb";
import { GuessGame } from "./GuessGame";
import type { GameSettings, GuessPhoto } from "./guessTypes";
import type { RoundResult } from "./GuessRound";

let mockStartSettings: GameSettings = { rounds: 2, timeLimit: 30, region: "Japan" };

jest.mock("./GuessMapDeferred", () => ({
  GuessMapDeferred: ({
    guess,
    reveal,
    onGuess,
  }: {
    guess: unknown;
    reveal?: unknown;
    onGuess: (lat: number, lng: number) => void;
  }) => (
    <button
      type="button"
      data-testid="guess-map"
      data-guess={JSON.stringify(guess)}
      data-reveal={JSON.stringify(reveal)}
      onClick={() => onGuess(10, 20)}
    >
      Map
    </button>
  ),
}));

jest.mock("../search/api", () => ({
  fetchGuessPhotos: jest.fn(),
}));

jest.mock("../../util/extractExifFromDb", () => ({
  extractGPSFromExifString: jest.fn(),
}));

jest.mock("./GuessLobby", () => ({
  GuessLobby: ({
    defaults,
    error,
    onStart,
  }: {
    defaults: GameSettings;
    error?: string | null;
    onStart: (settings: GameSettings) => void;
  }) => (
    <div data-testid="lobby" data-defaults={JSON.stringify(defaults)}>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" onClick={() => onStart(mockStartSettings)}>
        Start mocked game
      </button>
    </div>
  ),
}));

jest.mock("./GuessRound", () => ({
  GuessRound: ({
    photo,
    roundNumber,
    totalRounds,
    cumulativeScore,
    guess,
    onComplete,
    onReveal,
    onAbort,
    mapSlot,
  }: {
    photo: GuessPhoto;
    roundNumber: number;
    totalRounds: number;
    cumulativeScore: number;
    guess: { lat: number; lng: number } | null;
    onComplete: (result: RoundResult) => void;
    onReveal: () => void;
    onAbort: () => void;
    mapSlot: React.ReactNode;
  }) => {
    const completedResult: RoundResult = {
      photo,
      distanceMeters: 1_000,
      distanceScore: 1_000,
      timeBonus: 100,
      score: 1_100,
      skipped: false,
    };
    return (
      <div
        data-testid="round"
        data-round={roundNumber}
        data-total={totalRounds}
        data-score={cumulativeScore}
        data-guess={JSON.stringify(guess)}
      >
        {mapSlot}
        <button type="button" onClick={onReveal}>
          Reveal mocked round
        </button>
        <button type="button" onClick={() => onComplete(completedResult)}>
          Complete mocked round
        </button>
        <button type="button" onClick={onAbort}>
          Abort mocked round
        </button>
      </div>
    );
  },
}));

jest.mock("./GuessSummary", () => ({
  GuessSummary: ({
    results,
    seed,
    settings,
    onPlayAgain,
    onChangeSettings,
  }: {
    results: RoundResult[];
    seed: string;
    settings: GameSettings;
    onPlayAgain: () => void;
    onChangeSettings: () => void;
  }) => (
    <div
      data-testid="summary"
      data-results={results.length}
      data-seed={seed}
      data-settings={JSON.stringify(settings)}
    >
      <button type="button" onClick={onPlayAgain}>
        Play again
      </button>
      <button type="button" onClick={onChangeSettings}>
        Change settings
      </button>
    </div>
  ),
}));

const fetchGuessPhotosMock = jest.mocked(fetchGuessPhotos);
const extractGPSMock = jest.mocked(extractGPSFromExifString);
const database = {} as Parameters<typeof GuessGame>[0]["database"];

const validRows = [
  { path: "../albums/first/one.jpg", exif: "gps-one", geocode: "JP\nJapan" },
  { path: "../albums/first/one.jpg", exif: "gps-one", geocode: "JP\nJapan" },
  { path: "../albums/nowhere/no-gps.jpg", exif: "missing", geocode: "" },
  { path: "../albums//no-album.jpg", exif: "gps-one", geocode: "" },
  { path: "../albums", exif: "gps-one", geocode: "" },
  { path: "../albums/incomplete", exif: "gps-one", geocode: "" },
  { path: "../albums/second/two.jpg", exif: "gps-two", geocode: "FR\nFrance" },
];

describe("GuessGame", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStartSettings = { rounds: 2, timeLimit: 30, region: "Japan" };
    fetchGuessPhotosMock.mockResolvedValue(validRows);
    extractGPSMock.mockImplementation((exif) => {
      if (exif === "gps-one") return [35, 139];
      if (exif === "gps-two") return [48, 2];
      return null;
    });
    jest.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("runs the lobby, loading, rounds, reveal, and summary journey", async () => {
    const onSeedGenerated = jest.fn();
    render(<GuessGame database={database} onSeedGenerated={onSeedGenerated} />);

    expect(screen.getByTestId("lobby")).toHaveAttribute(
      "data-defaults",
      JSON.stringify({ rounds: 5, timeLimit: null }),
    );
    expect(fetchGuessPhotosMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start mocked game" }));
    expect(screen.getByText("Loading photos…")).toBeInTheDocument();

    const firstRound = await screen.findByTestId("round");
    expect(firstRound).toHaveAttribute("data-round", "1");
    expect(firstRound).toHaveAttribute("data-total", "2");
    expect(fetchGuessPhotosMock).toHaveBeenCalledWith({
      database,
      count: 7,
      region: "Japan",
      seed: "i",
    });
    expect(onSeedGenerated).toHaveBeenCalledWith("i");

    fireEvent.click(screen.getByTestId("guess-map"));
    expect(screen.getByTestId("round")).toHaveAttribute(
      "data-guess",
      JSON.stringify({ lat: 10, lng: 20 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reveal mocked round" }));
    expect(screen.getByTestId("guess-map")).toHaveAttribute(
      "data-reveal",
      JSON.stringify({ lat: 35, lng: 139 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Complete mocked round" }));
    expect(screen.getByTestId("round")).toHaveAttribute("data-round", "2");
    expect(screen.getByTestId("round")).toHaveAttribute("data-score", "1100");
    expect(screen.getByTestId("round")).toHaveAttribute("data-guess", "null");

    fireEvent.click(screen.getByRole("button", { name: "Complete mocked round" }));
    expect(screen.getByTestId("summary")).toHaveAttribute("data-results", "2");
    expect(screen.getByTestId("summary")).toHaveAttribute("data-seed", "i");
  });

  it("replays the same settings and can return to the lobby", async () => {
    render(
      <GuessGame
        database={database}
        initialSettings={{ rounds: 1, timeLimit: null }}
        seed="shared-seed"
      />,
    );
    await screen.findByTestId("round");
    expect(fetchGuessPhotosMock).toHaveBeenCalledWith({
      database,
      count: 6,
      region: undefined,
      seed: "shared-seed",
    });

    fireEvent.click(screen.getByRole("button", { name: "Complete mocked round" }));
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(screen.getByText("Loading photos…")).toBeInTheDocument();
    await waitFor(() => expect(fetchGuessPhotosMock).toHaveBeenCalledTimes(2));
    await screen.findByTestId("round");
    fireEvent.click(screen.getByRole("button", { name: "Abort mocked round" }));

    expect(screen.getByTestId("lobby")).toBeInTheDocument();
  });

  it("uses a camera-local calendar date for daily seeds", async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 14, 23, 30));
    render(
      <GuessGame
        database={database}
        initialSettings={{ rounds: 1, timeLimit: null, daily: true }}
      />,
    );

    await screen.findByTestId("round");
    expect(fetchGuessPhotosMock).toHaveBeenCalledWith(
      expect.objectContaining({ seed: "daily-2026-07-14" }),
    );
  });

  it("returns to the lobby when no usable GPS photos are available", async () => {
    fetchGuessPhotosMock.mockResolvedValue([
      { path: "../albums/first/one.jpg", exif: "missing", geocode: "" },
    ]);
    render(<GuessGame database={database} />);

    fireEvent.click(screen.getByRole("button", { name: "Start mocked game" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No GPS-tagged photos found. Try a different region.",
    );
  });

  it("reports database failures in the lobby", async () => {
    fetchGuessPhotosMock.mockRejectedValue(new Error("database unavailable"));
    render(<GuessGame database={database} />);

    fireEvent.click(screen.getByRole("button", { name: "Start mocked game" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to load photos from the database.",
    );
  });

  it("ignores a late response after unmount", async () => {
    let resolvePhotos!: (rows: typeof validRows) => void;
    fetchGuessPhotosMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePhotos = resolve;
      }),
    );
    const onSeedGenerated = jest.fn();
    const { unmount } = render(
      <GuessGame
        database={database}
        initialSettings={{ rounds: 1, timeLimit: null }}
        onSeedGenerated={onSeedGenerated}
      />,
    );

    unmount();
    resolvePhotos(validRows);
    await waitFor(() => expect(onSeedGenerated).not.toHaveBeenCalled());
  });

  it("ignores a late rejection after unmount", async () => {
    let rejectPhotos!: (error: Error) => void;
    fetchGuessPhotosMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectPhotos = reject;
      }),
    );
    const { unmount } = render(
      <GuessGame database={database} initialSettings={{ rounds: 1, timeLimit: null }} />,
    );

    unmount();
    rejectPhotos(new Error("late failure"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
