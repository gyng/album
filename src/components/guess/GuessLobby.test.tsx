/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetchGuessRegions } from "../search/api";
import { GuessLobby } from "./GuessLobby";
import { gameSettingsStorageKey } from "../fun/useGameSettings";
import { EMPTY_GAME_STATS, recordGameResult } from "../../util/gameStats";
import { dailyNumber, localDayKey } from "../../util/gameDaily";

jest.mock("../search/api", () => ({
  fetchGuessRegions: jest.fn(),
}));

const fetchGuessRegionsMock = jest.mocked(fetchGuessRegions);
const database = {} as Parameters<typeof GuessLobby>[0]["database"];

describe("GuessLobby", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/fun/guess");
    fetchGuessRegionsMock.mockResolvedValue([
      { country: "Japan", count: 12 },
      { country: "France", count: 8 },
    ]);
  });

  it("loads region availability and starts with the selected settings", async () => {
    const onStart = jest.fn();
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: null }}
        onStart={onStart}
      />,
    );

    expect(await screen.findByText("20 photos available")).toBeInTheDocument();
    expect(fetchGuessRegionsMock).toHaveBeenCalledWith({ database });

    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "Japan" } });
    expect(screen.getByText("12 photos available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "30 s" }));
    fireEvent.click(screen.getByRole("radio", { name: "10" }));
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    expect(onStart).toHaveBeenCalledWith({ rounds: 10, timeLimit: 30, region: "Japan" });
  });

  it("starts the same settings from the window keyboard shortcut", async () => {
    const onStart = jest.fn();
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 3, timeLimit: 15, region: "France" }}
        onStart={onStart}
      />,
    );
    await screen.findByText("8 photos available");

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onStart).toHaveBeenCalledWith({ rounds: 3, timeLimit: 15, region: "France" });
  });

  it("leaves Enter and Space handling to focused controls", async () => {
    const onStart = jest.fn();
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: null }}
        onStart={onStart}
      />,
    );
    await screen.findByText("20 photos available");
    const dailyButton = screen.getByRole("button", {
      name: `Daily #${dailyNumber(localDayKey())}`,
    });

    fireEvent.keyDown(dailyButton, { key: "Enter" });
    fireEvent.keyDown(dailyButton, { key: " " });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onStart).not.toHaveBeenCalled();
  });

  it("ignores held-key repeats, modified keys and keys behind an open dialog", async () => {
    const onStart = jest.fn();
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: null }}
        onStart={onStart}
      />,
    );
    await screen.findByText("20 photos available");

    fireEvent.keyDown(window, { key: "Enter", repeat: true });
    fireEvent.keyDown(window, { key: "Enter", altKey: true });
    fireEvent.keyDown(window, { key: " ", metaKey: true });
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: "Enter" });
    dialog.remove();

    expect(onStart).not.toHaveBeenCalled();
  });

  it("starts a fixed five-round untimed daily challenge", async () => {
    const onStart = jest.fn();
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 10, timeLimit: 30, region: "Japan" }}
        onStart={onStart}
      />,
    );
    await screen.findByText("12 photos available");

    const dailyButton = screen.getByRole("button", {
      name: `Daily #${dailyNumber(localDayKey())}`,
    });
    const description = screen.getByText("5 rounds · untimed");
    expect(dailyButton).toHaveAttribute("aria-describedby", description.id);
    fireEvent.click(dailyButton);

    expect(onStart).toHaveBeenCalledWith({ rounds: 5, timeLimit: null, daily: true });
  });

  it("omits an empty region and reports a load error", async () => {
    fetchGuessRegionsMock.mockResolvedValue([]);
    const onStart = jest.fn();
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: 99, region: "Missing" }}
        error="Could not load photos"
        onStart={onStart}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load photos");
    expect(screen.queryByText(/photos available/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    expect(onStart).toHaveBeenCalledWith({ rounds: 5, timeLimit: null });
  });

  it("does not apply a region response after unmount", async () => {
    let resolveRegions!: (regions: { country: string; count: number }[]) => void;
    fetchGuessRegionsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRegions = resolve;
      }),
    );
    const { unmount } = render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: null }}
        onStart={jest.fn()}
      />,
    );

    unmount();
    resolveRegions([{ country: "Japan", count: 12 }]);
    await waitFor(() => expect(screen.queryByText("12 photos available")).not.toBeInTheDocument());
  });

  it("restores selected region, timer and rounds after returning to the lobby", async () => {
    const first = render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: null }}
        onStart={jest.fn()}
      />,
    );
    await screen.findByText("20 photos available");
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "Japan" } });
    fireEvent.click(screen.getByRole("radio", { name: "15 s" }));
    fireEvent.click(screen.getByRole("radio", { name: "10" }));
    first.unmount();
    const onStart = jest.fn();
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: null }}
        onStart={onStart}
      />,
    );
    await screen.findByText("12 photos available");
    expect(screen.getByLabelText("Region")).toHaveValue("Japan");
    expect(screen.getByRole("radio", { name: "15 s" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "10" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    expect(onStart).toHaveBeenCalledWith({ rounds: 10, timeLimit: 15, region: "Japan" });
  });

  it("lets explicit URL fields outrank saved choices without resetting unsupplied fields", async () => {
    localStorage.setItem(
      gameSettingsStorageKey("guess"),
      JSON.stringify({ region: "France", rounds: 10, timeLimit: 30 }),
    );
    window.history.replaceState(null, "", "/fun/guess?timer=off&region=Japan");
    const onStart = jest.fn();
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: null }}
        onStart={onStart}
      />,
    );
    await screen.findByText("12 photos available");
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    expect(onStart).toHaveBeenCalledWith({ rounds: 10, timeLimit: null, region: "Japan" });
  });

  it("clears an unavailable saved region only after a successful availability lookup", async () => {
    localStorage.setItem(
      gameSettingsStorageKey("guess"),
      JSON.stringify({ region: "Missing", rounds: 3, timeLimit: 15 }),
    );
    const onStart = jest.fn();
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: null }}
        onStart={onStart}
      />,
    );
    await screen.findByText("20 photos available");
    expect(screen.getByLabelText("Region")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    expect(onStart).toHaveBeenCalledWith({ rounds: 3, timeLimit: 15 });
  });

  it("preserves a saved region when availability fails to load", async () => {
    localStorage.setItem(
      gameSettingsStorageKey("guess"),
      JSON.stringify({ region: "France", rounds: 5, timeLimit: null }),
    );
    fetchGuessRegionsMock.mockRejectedValue(new Error("offline"));
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: null }}
        onStart={jest.fn()}
      />,
    );
    await waitFor(() => expect(fetchGuessRegionsMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(gameSettingsStorageKey("guess"))!).region).toBe(
        "France",
      ),
    );
  });

  it("shows the player's record once a game has been finished", async () => {
    const stats = recordGameResult(EMPTY_GAME_STATS, { won: false, score: 12_000 }, localDayKey());
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: null }}
        onStart={jest.fn()}
        stats={stats}
      />,
    );
    await screen.findByText("20 photos available");
    expect(screen.getByText("Played 1 · best 12,000")).toBeInTheDocument();
  });

  it("offers today's result to share instead of replaying a finished daily", async () => {
    const today = localDayKey();
    const stats = recordGameResult(
      EMPTY_GAME_STATS,
      { won: false, score: 18_420, daily: { day: today, summary: "18,420 / 25,000 points" } },
      today,
    );
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onStart = jest.fn();
    render(
      <GuessLobby
        database={database}
        defaults={{ rounds: 5, timeLimit: null }}
        onStart={onStart}
        stats={stats}
      />,
    );
    await screen.findByText("20 photos available");
    expect(
      screen.queryByRole("button", { name: `Daily #${dailyNumber(localDayKey())}` }),
    ).toBeNull();
    expect(screen.getByText(/18,420 \/ 25,000 points/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share result" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text: string = writeText.mock.calls[0][0];
    expect(text).toContain(`Guess Where #${dailyNumber(today)}`);
    expect(text).toContain("18,420 / 25,000 points");
    expect(text).toMatch(/\/fun\/guess\?daily$/);
    expect(onStart).not.toHaveBeenCalled();
  });
});
