/**
 * @jest-environment jsdom
 */

import { fireEvent, screen } from "@testing-library/react";
import { renderWithNextPlatform as render } from "../../renderWithNextPlatform";
import { useRouter } from "next/router";
import { useDatabase } from "../../../components/database/useDatabase";
import GuessPage from "../../../screens/guess/GuessScreen";
import { gameSettingsStorageKey } from "../../../components/fun/useGameSettings";
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

let mockLoadedSettings: GameSettings | null = null;
let mockLoadedSeed: string | null = null;

jest.mock("../../../components/guess/GuessGame", () => ({
  GuessGame: ({
    initialSettings,
    seed,
    onSeedGenerated,
  }: {
    initialSettings?: GameSettings;
    seed?: string;
    onSeedGenerated?: (seed: string, settings: GameSettings) => void;
  }) => (
    <div data-testid="guess-game" data-settings={JSON.stringify(initialSettings)} data-seed={seed}>
      <button
        type="button"
        onClick={() =>
          onSeedGenerated?.(
            mockLoadedSeed ?? seed ?? "generated-seed",
            mockLoadedSettings ?? initialSettings ?? { rounds: 10, timeLimit: 15, region: "Japan" },
          )
        }
      >
        Generate seed
      </button>
    </div>
  ),
}));

const useRouterMock = jest.mocked(useRouter);
const useDatabaseMock = jest.mocked(useDatabase);
const database = {} as NonNullable<ReturnType<typeof useDatabase>[0]>;

// Next's shallow replace, as far as the screen can observe it: the URL changes.
const routerReplace = jest.fn((href: string) => {
  window.history.replaceState(null, "", href);
  return Promise.resolve(true);
});

const setQuery = (
  query: Record<string, string | string[] | undefined>,
  isReady = true,
  asPath?: string,
) => {
  useRouterMock.mockReturnValue({
    query,
    isReady,
    pathname: "/fun/guess",
    replace: routerReplace,
    ...(asPath ? { asPath } : {}),
  } as unknown as ReturnType<typeof useRouter>);
};

describe("GuessPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockLoadedSettings = null;
    mockLoadedSeed = null;
    setQuery({});
    useDatabaseMock.mockReturnValue([database, 100] as unknown as ReturnType<typeof useDatabase>);
    window.history.replaceState(null, "", "/guess");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows database loading progress before the game can start", () => {
    useDatabaseMock.mockReturnValue([null, 37] as unknown as ReturnType<typeof useDatabase>);

    render(<GuessPage />);

    expect(screen.getByText("Loading photo database…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "37");
    expect(screen.queryByTestId("guess-game")).not.toBeInTheDocument();
  });

  // Regression: with no search index this page showed a 0% progress bar and no
  // exit, because the destructure dropped the hook's error channel.
  it("explains the missing index instead of loading forever when the database fails", () => {
    useDatabaseMock.mockReturnValue([
      null,
      0,
      null,
      new Error("404"),
      jest.fn(),
    ] as unknown as ReturnType<typeof useDatabase>);

    render(<GuessPage />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All games" })).toHaveAttribute("href", "/fun");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("waits for deep-link query state before mounting the game state machine", () => {
    setQuery({ daily: "" }, false);
    const { rerender } = render(<GuessPage />);

    expect(screen.queryByTestId("guess-game")).not.toBeInTheDocument();

    setQuery({ daily: "" }, true);
    rerender(<GuessPage />);

    expect(screen.getByTestId("guess-game")).toHaveAttribute(
      "data-settings",
      JSON.stringify({ rounds: 5, timeLimit: null, daily: true }),
    );
  });

  it("starts at the lobby and persists a newly generated seed in the URL", () => {
    setQuery({}, true, "/fun/guess?region=Japan");

    render(<GuessPage />);

    expect(screen.getByTestId("guess-game")).not.toHaveAttribute("data-settings");
    expect(screen.getByTestId("guess-game")).not.toHaveAttribute("data-seed");
    expect(screen.getByTestId("seo")).toHaveAttribute(
      "data-description",
      "Test your geography — guess where each photo was taken on the map.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate seed" }));

    expect(routerReplace).toHaveBeenLastCalledWith(
      "/fun/guess?region=Japan&seed=generated-seed&rounds=10&timer=15",
      undefined,
      { shallow: true },
    );
  });

  it("keeps the daily challenge URL independent of a generated date-specific seed", () => {
    setQuery({ daily: "" }, true, "/fun/guess?daily");

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
    expect(routerReplace).toHaveBeenCalledWith("/fun/guess?daily=", undefined, { shallow: true });
  });

  it("uses today's daily seed even when an older link includes a stale seed", () => {
    setQuery({ daily: "", seed: "daily-old-date" });
    render(<GuessPage />);
    expect(screen.getByTestId("guess-game")).not.toHaveAttribute("data-seed");
    expect(screen.getByTestId("guess-game")).toHaveAttribute(
      "data-settings",
      JSON.stringify({ rounds: 5, timeLimit: null, daily: true }),
    );
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
      { seed: "shared", rounds: "-4", timer: "invalid", region: ["France", "Japan"] },
      { rounds: 1, timeLimit: null },
    ],
    [
      { seed: "shared", rounds: "not-a-number" },
      { rounds: 5, timeLimit: null },
    ],
  ])("parses seeded challenge query %p", (query, settings) => {
    setQuery(query);

    render(<GuessPage />);

    expect(screen.getByTestId("guess-game")).toHaveAttribute(
      "data-settings",
      JSON.stringify(settings),
    );
    expect(screen.getByTestId("guess-game")).toHaveAttribute("data-seed", "shared");
    expect(screen.getByTestId("seo")).toHaveAttribute("data-pathname", "/fun/guess?seed=shared");
    expect(screen.getByTestId("seo")).toHaveAttribute(
      "data-description",
      "Can you beat this score? Guess where each photo was taken.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate seed" }));
    expect(routerReplace).toHaveBeenCalled();
    const params = new URLSearchParams(window.location.search);
    expect(params.get("seed")).toBe("shared");
    expect(params.get("rounds")).toBe(String(settings.rounds));
    expect(params.get("timer")).toBe(
      settings.timeLimit === null ? "off" : String(settings.timeLimit),
    );
    expect(params.get("region")).toBe("region" in settings ? settings.region : "");
  });

  it("ignores array-valued seed parameters", () => {
    setQuery({ seed: ["one", "two"] });

    render(<GuessPage />);

    expect(screen.getByTestId("guess-game")).not.toHaveAttribute("data-seed");
    expect(screen.getByTestId("seo")).toHaveAttribute("data-pathname", "/fun/guess");
  });

  it("uses saved choices for a seed-only link before the game mounts", () => {
    localStorage.setItem(
      gameSettingsStorageKey("guess"),
      JSON.stringify({ region: "France", rounds: 10, timeLimit: 30 }),
    );
    setQuery({ seed: "shared" });
    render(<GuessPage />);
    expect(screen.getByTestId("guess-game")).toHaveAttribute(
      "data-settings",
      JSON.stringify({ rounds: 10, timeLimit: 30, region: "France" }),
    );
  });

  it("overrides only explicit seeded fields and keeps daily fixed despite saved preferences", () => {
    localStorage.setItem(
      gameSettingsStorageKey("guess"),
      JSON.stringify({ region: "France", rounds: 10, timeLimit: 30 }),
    );
    setQuery({ seed: "shared", timer: "off", region: "" });
    const first = render(<GuessPage />);
    expect(screen.getByTestId("guess-game")).toHaveAttribute(
      "data-settings",
      JSON.stringify({ rounds: 10, timeLimit: null }),
    );
    first.unmount();
    setQuery({ daily: "" });
    render(<GuessPage />);
    expect(screen.getByTestId("guess-game")).toHaveAttribute(
      "data-settings",
      JSON.stringify({ rounds: 5, timeLimit: null, daily: true }),
    );
  });

  it("updates a previously generated URL when another game starts with changed choices", () => {
    const view = render(<GuessPage />);
    fireEvent.click(screen.getByRole("button", { name: "Generate seed" }));
    setQuery({ seed: "generated-seed", rounds: "10", timer: "15", region: "Japan" });
    view.rerender(<GuessPage />);
    mockLoadedSeed = "next-seed";
    mockLoadedSettings = { rounds: 3, timeLimit: null };
    fireEvent.click(screen.getByRole("button", { name: "Generate seed" }));
    const params = new URLSearchParams(window.location.search);
    expect(Object.fromEntries(params)).toEqual({
      seed: "next-seed",
      rounds: "3",
      timer: "off",
      region: "",
    });
  });

  it("removes stale daily flags when a custom game starts and stale settings when Daily starts", () => {
    setQuery({}, true, "/fun/guess?daily&seed=old&rounds=10&timer=30&region=Japan&theme=darkroom");
    const view = render(<GuessPage />);
    mockLoadedSeed = "custom";
    mockLoadedSettings = { rounds: 3, timeLimit: 15, region: "France" };
    fireEvent.click(screen.getByRole("button", { name: "Generate seed" }));
    expect(new URLSearchParams(window.location.search).has("daily")).toBe(false);
    setQuery({ seed: "custom", rounds: "3", timer: "15", region: "France", theme: "darkroom" });
    view.rerender(<GuessPage />);
    mockLoadedSettings = { rounds: 5, timeLimit: null, daily: true };
    fireEvent.click(screen.getByRole("button", { name: "Generate seed" }));
    expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({
      theme: "darkroom",
      daily: "",
    });
  });
});
