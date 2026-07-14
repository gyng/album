/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/router";
import { useDatabase } from "../../../components/database/useDatabase";
import GuessPage from "../../../pages/guess";
import type { GameSettings } from "../../../components/guess/guessTypes";

jest.mock("next/router", () => ({
  useRouter: jest.fn(),
}));

jest.mock("../../../components/database/useDatabase", () => ({
  useDatabase: jest.fn(),
}));

jest.mock("../../../components/GlobalNav", () => ({
  GlobalNav: () => <nav>Global navigation</nav>,
}));

jest.mock("../../../components/ProgressBar", () => ({
  ProgressBar: ({ progress }: { progress: number }) => (
    <div role="progressbar" aria-valuenow={progress} />
  ),
}));

jest.mock("../../../components/Seo", () => ({
  Seo: ({ description, pathname }: { description: string; pathname: string }) => (
    <div data-testid="seo" data-description={description} data-pathname={pathname} />
  ),
}));

jest.mock("../../../components/guess/GuessGame", () => ({
  GuessGame: ({
    initialSettings,
    seed,
    onSeedGenerated,
  }: {
    initialSettings?: GameSettings;
    seed?: string;
    onSeedGenerated?: (seed: string) => void;
  }) => (
    <div data-testid="guess-game" data-settings={JSON.stringify(initialSettings)} data-seed={seed}>
      <button type="button" onClick={() => onSeedGenerated?.("generated-seed")}>
        Generate seed
      </button>
    </div>
  ),
}));

const useRouterMock = jest.mocked(useRouter);
const useDatabaseMock = jest.mocked(useDatabase);
const database = {} as NonNullable<ReturnType<typeof useDatabase>[0]>;

const setQuery = (query: Record<string, string | string[] | undefined>) => {
  useRouterMock.mockReturnValue({ query } as ReturnType<typeof useRouter>);
};

describe("GuessPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setQuery({});
    useDatabaseMock.mockReturnValue([database, 100]);
    window.history.replaceState(null, "", "/guess");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows database loading progress before the game can start", () => {
    useDatabaseMock.mockReturnValue([null, 37]);

    render(<GuessPage />);

    expect(screen.getByText("Loading photo database…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "37");
    expect(screen.queryByTestId("guess-game")).not.toBeInTheDocument();
  });

  it("starts at the lobby and persists a newly generated seed in the URL", () => {
    window.history.replaceState(null, "", "/guess?region=Japan");
    const replaceState = jest.spyOn(window.history, "replaceState");

    render(<GuessPage />);

    expect(screen.getByTestId("guess-game")).not.toHaveAttribute("data-settings");
    expect(screen.getByTestId("guess-game")).not.toHaveAttribute("data-seed");
    expect(screen.getByTestId("seo")).toHaveAttribute(
      "data-description",
      "Test your geography — guess where each photo was taken on the map.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate seed" }));

    expect(replaceState).toHaveBeenLastCalledWith(null, "", "?region=Japan&seed=generated-seed");
  });

  it("configures the daily challenge and retains its URL flag when adding the seed", () => {
    setQuery({ daily: "" });
    window.history.replaceState(null, "", "/guess?daily");
    const replaceState = jest.spyOn(window.history, "replaceState");

    render(<GuessPage />);

    expect(screen.getByTestId("guess-game")).toHaveAttribute(
      "data-settings",
      JSON.stringify({ rounds: 5, timeLimit: null, daily: true }),
    );
    expect(screen.getByTestId("seo")).toHaveAttribute(
      "data-description",
      "Today's daily challenge — guess where each photo was taken.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate seed" }));
    expect(replaceState).toHaveBeenCalledWith(null, "", "?daily=&seed=generated-seed");
  });

  it.each([
    [
      { seed: "shared", rounds: "3", timer: "15", region: "France" },
      { rounds: 3, timeLimit: 15, region: "France" },
    ],
    [
      { seed: "shared", rounds: "99", timer: "30" },
      { rounds: 20, timeLimit: 30 },
    ],
    [
      { seed: "shared", rounds: "-4", timer: "invalid", region: ["France"] },
      { rounds: 1, timeLimit: null },
    ],
    [
      { seed: "shared", rounds: "not-a-number" },
      { rounds: 5, timeLimit: null },
    ],
  ])("parses seeded challenge query %p", (query, settings) => {
    setQuery(query);
    const replaceState = jest.spyOn(window.history, "replaceState");

    render(<GuessPage />);

    expect(screen.getByTestId("guess-game")).toHaveAttribute(
      "data-settings",
      JSON.stringify(settings),
    );
    expect(screen.getByTestId("guess-game")).toHaveAttribute("data-seed", "shared");
    expect(screen.getByTestId("seo")).toHaveAttribute("data-pathname", "/guess?seed=shared");
    expect(screen.getByTestId("seo")).toHaveAttribute(
      "data-description",
      "Can you beat this score? Guess where each photo was taken.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate seed" }));
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("ignores array-valued seed parameters", () => {
    setQuery({ seed: ["one", "two"] });

    render(<GuessPage />);

    expect(screen.getByTestId("guess-game")).not.toHaveAttribute("data-seed");
    expect(screen.getByTestId("seo")).toHaveAttribute("data-pathname", "/guess");
  });
});
