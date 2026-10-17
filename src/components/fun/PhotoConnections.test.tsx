/** @jest-environment jsdom */
import { StrictMode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { dailyConnectionsPuzzle, PhotoConnections } from "./PhotoConnections";
import { dailyPuzzle } from "./GameRecord";
import { gameStatsStorageKey, readGameStats } from "./useGameStats";
import { gameSettingsStorageKey } from "./useGameSettings";
import { shuffleGamePhotos, type PhotoGamePhoto } from "../../util/photoGames";
import { seededRandom } from "../../util/seededRandom";
beforeEach(() => localStorage.clear());
afterEach(() => window.history.replaceState(null, "", "/"));

const photos: PhotoGamePhoto[] = ["A cat", "A lake", "A red flower", "A train"].flatMap(
  (caption, group) =>
    Array.from({ length: 5 }, (_, i) => ({
      path: `${group}-${i}.jpg`,
      href: `/album/test-simple#${group}-${i}`,
      caption,
      tags: "",
      vector: [],
    })),
);
const choose = (name: string, count: number) =>
  screen
    .getAllByRole("img", { name })
    .slice(0, count)
    .forEach((image) => fireEvent.click(image.closest("button")!));
it("checks groups, avoids charging twice for the same mistake and reveals all connections", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  fireEvent.click(screen.getByRole("button", { name: "Auto check" }));
  choose("A cat", 2);
  choose("A lake", 2);
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(screen.getByText("1 mistake · Unlimited lives")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(screen.getByText("1 mistake · Unlimited lives")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Deselect" }));
  choose("A cat", 4);
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(screen.getByRole("status")).toHaveTextContent(/connection found/);
  expect(
    within(screen.getByRole("group", { name: "Photographs" })).getAllByRole("button"),
  ).toHaveLength(12);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(
    within(screen.getByRole("region", { name: "Connections result" })).getAllByRole("img"),
  ).toHaveLength(16);
});
// The board is long enough to scroll past the round's header, so what a check
// says goes in the controls that stay on screen with the reader.
it("says what a check found in the controls that stay on screen", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  fireEvent.click(screen.getByRole("button", { name: "Auto check" }));
  const controls = within(screen.getByRole("group", { name: "Connection controls" }));
  expect(controls.getByRole("status")).toHaveTextContent("0 / 4 selected");

  choose("A cat", 2);
  choose("A lake", 2);
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(controls.getByRole("status")).toHaveTextContent("You’ve already tried that group.");
});
// A hint names a connection still to find — never which photographs are in it
// — one more each time, and a solved connection's name drops off the list.
it("names an unfound connection for each hint asked for", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  fireEvent.click(screen.getByRole("button", { name: "Auto check" }));
  const hint = screen.getByRole("button", { name: "Hint" });

  fireEvent.click(hint);
  const named = () =>
    within(screen.getByRole("list", { name: "Hints" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
  expect(named()).toHaveLength(1);
  fireEvent.click(hint);
  expect(named()).toHaveLength(2);
  const [first, second] = named();
  expect(first).not.toBe(second);

  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  const result = within(screen.getByRole("region", { name: "Connections result" }));
  expect(result.getByRole("region", { name: first! })).toBeTruthy();
  expect(result.getByRole("region", { name: second! })).toBeTruthy();
});
it("stops offering hints once every remaining connection has been named", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  const hint = screen.getByRole("button", { name: "Hint" });
  for (let i = 0; i < 4; i++) fireEvent.click(hint);
  expect(hint).toBeDisabled();
});
it("ends after four different mistakes and reveals the groups", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "4 lives" }));
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  fireEvent.click(screen.getByRole("button", { name: "Auto check" }));
  const cats = screen.getAllByRole("img", { name: "A cat" });
  const boats = screen.getAllByRole("img", { name: "A lake" });
  for (let i = 0; i < 4; i++) {
    [cats[i]!, cats[(i + 1) % 4]!, boats[i]!, boats[(i + 1) % 4]!].forEach((image) =>
      fireEvent.click(image.closest("button")!),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    if (i < 3) fireEvent.click(screen.getByRole("button", { name: "Deselect" }));
  }
  expect(screen.getByRole("region", { name: "Connections result" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Check connection" })).toBeNull();
});

it("lets players choose a six-by-six board and reveals all six groups", () => {
  const archive = ["A cat", "A lake", "A train", "A person", "A mountain", "A staircase"].flatMap(
    (caption, group) =>
      Array.from({ length: 6 }, (_, i) => ({
        path: `${group}-${i}.jpg`,
        href: "/album/test-simple",
        caption,
        tags: "",
        vector: [],
      })),
  );
  render(<PhotoConnections photos={archive} />);
  fireEvent.click(screen.getByRole("button", { name: "6×6" }));
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  fireEvent.click(screen.getByRole("button", { name: "Auto check" }));
  expect(
    within(screen.getByRole("group", { name: "Photographs" })).getAllByRole("button"),
  ).toHaveLength(36);
  choose("A cat", 6);
  expect(screen.getByRole("button", { name: "Check connection" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(
    within(screen.getByRole("group", { name: "Photographs" })).getAllByRole("button"),
  ).toHaveLength(30);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(
    within(screen.getByRole("region", { name: "Connections result" })).getAllByRole("img"),
  ).toHaveLength(36);
});

it("restores lobby preferences after remount without restoring an active round", () => {
  const first = render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "6×6" }));
  fireEvent.click(screen.getByRole("button", { name: "Specific subjects" }));
  fireEvent.click(screen.getByRole("button", { name: "8 lives" }));
  fireEvent.click(screen.getByRole("button", { name: "One-away hints on" }));
  first.unmount();
  render(<PhotoConnections photos={photos} />);
  expect(screen.getByRole("button", { name: "6×6" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Specific subjects" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "One-away hints off" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "8 lives" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Start connecting" })).toBeTruthy();
});

it("keeps active selection controls together and removes the dock from the results", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  fireEvent.click(screen.getByRole("button", { name: "Auto check" }));
  const controls = screen.getByRole("group", { name: "Connection controls" });
  expect(within(controls).getByRole("button", { name: "Check connection" })).toBeDisabled();
  choose("A cat", 4);
  expect(within(controls).getByRole("button", { name: "Check connection" })).toBeEnabled();
  fireEvent.click(within(controls).getByRole("button", { name: "Deselect" }));
  expect(
    within(screen.getByRole("group", { name: "Photographs" }))
      .getAllByRole("button")
      .every((button) => button.getAttribute("aria-pressed") === "false"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(screen.queryByRole("group", { name: "Connection controls" })).toBeNull();
  expect(screen.getByRole("region", { name: "Connections result" })).toHaveFocus();
});

const makeMistakes = (count: number) => {
  const cats = screen.getAllByRole("img", { name: "A cat" });
  const lakes = screen.getAllByRole("img", { name: "A lake" });
  const pairs = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ];
  for (let index = 0; index < count; index++) {
    const pair = pairs[index % pairs.length]!;
    const lake = Math.floor(index / pairs.length);
    [cats[pair[0]!]!, cats[pair[1]!]!, lakes[lake]!, lakes[lake + 1]!].forEach((image) =>
      fireEvent.click(image.closest("button")!),
    );
    fireEvent.keyDown(document.body, { key: "Enter" });
    if (index + 1 < count) fireEvent.keyDown(document.body, { key: "Escape" });
  }
};

it("keeps unlimited rounds playable beyond eight distinct mistakes", () => {
  render(<PhotoConnections photos={photos} />);
  expect(screen.getByRole("button", { name: "Unlimited" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(document.body, { key: "n" });
  makeMistakes(8);
  expect(screen.getByText("8 mistakes · Unlimited lives")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Connections result" })).toBeNull();
  expect(screen.getByRole("button", { name: "Check connection" })).toBeEnabled();
});

it.each([6, 8])("ends at the selected %i-life budget", (lives) => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: `${lives} lives` }));
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  fireEvent.click(screen.getByRole("button", { name: "Auto check" }));
  makeMistakes(lives - 1);
  expect(screen.queryByRole("region", { name: "Connections result" })).toBeNull();
  fireEvent.keyDown(document.body, { key: "Escape" });
  const cats = screen.getAllByRole("img", { name: "A cat" });
  const lakes = screen.getAllByRole("img", { name: "A lake" });
  // One fresh mixed group, distinct from the mistakes above.
  [cats[0]!, lakes[0]!, lakes[1]!, lakes[2]!].forEach((image) =>
    fireEvent.click(image.closest("button")!),
  );
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(screen.getByRole("region", { name: "Connections result" })).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Check connection" })).toBeNull();
});

it("names tiles by their photographs and keeps focus on the board", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  fireEvent.click(screen.getByRole("button", { name: "Auto check" }));
  const board = screen.getByRole("group", { name: "Photographs" });
  expect(board).toHaveFocus();
  expect(within(board).getAllByRole("button", { name: "A cat" })).toHaveLength(4);
  choose("A cat", 4);
  const check = screen.getByRole("button", { name: "Check connection" });
  check.focus();
  fireEvent.click(check);
  expect(screen.getByRole("region", { name: "Animals" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.getByRole("group", { name: "Photographs" })).toHaveFocus();
});

it("keeps focused tiles clear of the sticky dock on small screens", () => {
  const match = jest.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: query.includes("max-width"),
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }) as unknown as MediaQueryList,
  );
  const rect = jest
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockReturnValue({ height: 60 } as DOMRect);
  try {
    const { container } = render(<PhotoConnections photos={photos} />);
    fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
    fireEvent.click(screen.getByRole("button", { name: "Auto check" }));
    expect(
      (container.firstElementChild as HTMLElement).style.getPropertyValue(
        "--connections-dock-height",
      ),
    ).toBe("60px");
  } finally {
    match.mockRestore();
    rect.mockRestore();
  }
});

describe("daily", () => {
  const today = dailyPuzzle("connections");
  const dailyName = `Daily #${today.number}`;
  const archive: PhotoGamePhoto[] = [
    "A cat",
    "A lake",
    "A train",
    "A mountain",
    "A staircase",
    "A bridge",
  ].flatMap((caption, group) =>
    Array.from({ length: 6 }, (_, i) => ({
      path: `${group}-${i}.jpg`,
      href: "/album/test-simple",
      caption,
      tags: "",
      vector: [],
    })),
  );
  const boardOf = (photos: PhotoGamePhoto[]) => {
    const puzzle = dailyConnectionsPuzzle(photos, today.day)!;
    return {
      groups: puzzle.groups.map((group) => [group.id, group.photos.map((photo) => photo.path)]),
      tiles: puzzle.tiles.map((photo) => photo.path),
    };
  };

  it("deals the same board on every device, whatever order the archive arrives in", () => {
    const first = boardOf(shuffleGamePhotos(archive, seededRandom("device one")));
    const second = boardOf(shuffleGamePhotos(archive, seededRandom("device two")));
    expect(first.groups).toHaveLength(4);
    expect(second).toEqual(first);
  });

  it("plays the fixed daily board without replacing saved settings", () => {
    const saved = { size: 6, detail: "specific", hints: false, lives: 8 };
    localStorage.setItem(gameSettingsStorageKey("connections"), JSON.stringify(saved));
    render(<PhotoConnections photos={archive} />);
    fireEvent.click(screen.getByRole("button", { name: dailyName }));
    expect(
      within(screen.getByRole("group", { name: "Photographs" })).getAllByRole("button"),
    ).toHaveLength(16);
    expect(screen.getByText("4 mistakes remaining")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    expect(JSON.parse(localStorage.getItem(gameSettingsStorageKey("connections"))!)).toEqual(saved);
    expect(window.location.search).toBe("?daily=");
  });

  it("records each finished game exactly once", () => {
    render(
      <StrictMode>
        <PhotoConnections photos={photos} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
    fireEvent.click(screen.getByRole("button", { name: "Auto check" }));
    choose("A cat", 4);
    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    expect(readGameStats("connections")).toMatchObject({ played: 1, won: 0, dailies: {} });
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    for (const name of ["A cat", "A lake", "A red flower", "A train"]) {
      choose(name, 4);
      fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    }
    expect(screen.getByRole("heading", { name: "All connected" })).toBeTruthy();
    expect(readGameStats("connections")).toMatchObject({ played: 2, won: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Change board size" }));
    expect(screen.getByText(/Played 2 · won 1/)).toBeTruthy();
  });

  // A shared score says how it was got.
  it("counts the hints a daily used in its result", () => {
    render(<PhotoConnections photos={archive} />);
    fireEvent.click(screen.getByRole("button", { name: dailyName }));
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    expect(readGameStats("connections").dailies[today.day]?.summary).toBe(
      "Gave up · 0 of 4 connections · 1 hint",
    );
  });

  it("shares a finished daily and shows its result instead of offering it again", () => {
    render(<PhotoConnections photos={archive} />);
    fireEvent.click(screen.getByRole("button", { name: dailyName }));
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    const result = screen.getByRole("region", { name: "Connections result" });
    expect(within(result).getByRole("button", { name: "Share result" })).toBeTruthy();
    expect(readGameStats("connections").dailies[today.day]).toEqual({
      won: false,
      summary: "Gave up · 0 of 4 connections",
    });
    fireEvent.click(screen.getByRole("button", { name: "Change board size" }));
    expect(screen.queryByRole("button", { name: dailyName })).toBeNull();
    expect(screen.getByText(`${dailyName} · Gave up · 0 of 4 connections`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share result" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start connecting" })).toBeEnabled();
  });

  it("opens today's board from the URL, and its result once it is finished", () => {
    window.history.replaceState(null, "", "/fun/connections?daily");
    const first = render(<PhotoConnections photos={archive} />);
    expect(
      within(screen.getByRole("group", { name: "Photographs" })).getAllByRole("button"),
    ).toHaveLength(16);
    first.unmount();
    localStorage.setItem(
      gameStatsStorageKey("connections"),
      JSON.stringify({
        played: 1,
        won: 1,
        streak: 1,
        bestStreak: 1,
        lastDay: today.day,
        dailies: { [today.day]: { won: true, summary: "4×4 · No mistakes" } },
      }),
    );
    render(<PhotoConnections photos={archive} />);
    expect(screen.queryByRole("group", { name: "Photographs" })).toBeNull();
    expect(screen.getByText(`${dailyName} · 4×4 · No mistakes`)).toBeTruthy();
  });
});

it("automatically checks a full selection by default and can switch to manual checking", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  const toggle = screen.getByRole("button", { name: "Auto check" });
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  choose("A cat", 3);
  expect(screen.queryByRole("region", { name: "Animals" })).toBeNull();
  const board = screen.getByRole("group", { name: "Photographs" });
  fireEvent.click(within(board).getAllByRole("button", { name: "A cat" })[3]!);
  expect(screen.getByRole("region", { name: "Animals" })).toBeTruthy();
  fireEvent.click(toggle);
  choose("A lake", 4);
  expect(within(board).getAllByRole("button")).toHaveLength(12);
  expect(screen.getByRole("button", { name: "Check connection" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(within(board).getAllByRole("button")).toHaveLength(8);
});
it("auto-checks mistakes once, permits correcting them and checks a full selection when enabled", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  choose("A cat", 2);
  choose("A lake", 2);
  expect(screen.getByText("1 mistake · Unlimited lives")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(screen.getByText("1 mistake · Unlimited lives")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Deselect" }));
  const toggle = screen.getByRole("button", { name: "Auto check" });
  fireEvent.click(toggle);
  choose("A cat", 4);
  expect(screen.queryByRole("region", { name: "Animals" })).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole("region", { name: "Animals" })).toBeTruthy();
});
