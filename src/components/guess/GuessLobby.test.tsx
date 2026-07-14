/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetchGuessRegions } from "../search/api";
import { GuessLobby } from "./GuessLobby";

jest.mock("../search/api", () => ({
  fetchGuessRegions: jest.fn(),
}));

const fetchGuessRegionsMock = jest.mocked(fetchGuessRegions);
const database = {} as Parameters<typeof GuessLobby>[0]["database"];

describe("GuessLobby", () => {
  beforeEach(() => {
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
    const dailyButton = screen.getByRole("button", { name: "Daily challenge" });

    fireEvent.keyDown(dailyButton, { key: "Enter" });
    fireEvent.keyDown(dailyButton, { key: " " });
    fireEvent.keyDown(window, { key: "Escape" });

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

    fireEvent.click(screen.getByRole("button", { name: "Daily challenge" }));

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
});
