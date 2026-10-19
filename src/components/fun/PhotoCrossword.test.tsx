/** @jest-environment jsdom */
import { StrictMode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { dailyCrosswordPuzzle, PhotoCrossword } from "./PhotoCrossword";
import { dailyPuzzle } from "./GameRecord";
import { gameStatsStorageKey, readGameStats } from "./useGameStats";
import { gameSettingsStorageKey } from "./useGameSettings";
import { buildPhotoCrossword, type PhotoCrosswordPuzzle } from "../../util/photoCrossword";
import { shuffleGamePhotos, type PhotoGamePhoto, type OracleQuestion } from "../../util/photoGames";
import { seededRandom } from "../../util/seededRandom";
jest.mock("./GameIllustration", () => ({
  GameIntro: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock("../../util/photoCrossword", () => ({
  ...jest.requireActual("../../util/photoCrossword"),
  buildPhotoCrossword: jest.fn(),
}));
const rows = ["round", "square", "triangle"];
const cols = ["scarlet", "azure", "golden"];
const tag = (id: string): OracleQuestion => ({
  id,
  label: `Does it feature ${id}?`,
  matches: (p) => p.tags.split(",").includes(id),
});
const photos: PhotoGamePhoto[] = rows.flatMap((row, r) =>
  cols.map((col, c) => ({
    path: `../albums/test-simple/${r}-${c}.jpg`,
    href: `/album/test-simple#${r}-${c}.jpg`,
    caption: `${row} ${col}`,
    tags: `${row},${col}`,
    vector: [],
  })),
);
const puzzle: PhotoCrosswordPuzzle = {
  size: 3,
  rows: rows.map(tag),
  columns: cols.map(tag),
  solution: photos,
  tiles: photos,
};
beforeEach(() => {
  window.localStorage.clear();
  jest.mocked(buildPhotoCrossword).mockReturnValue(puzzle);
});
const startVisible = () => {
  render(<PhotoCrossword photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Visible clues" }));
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
};
it("checks both crossing clues, lets players remove or swap a placement, and completes a valid grid", () => {
  startVisible();
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  fireEvent.click(screen.getByRole("button", { name: /Row 1: round; column B/ }));
  fireEvent.click(screen.getByRole("button", { name: "Check grid" }));
  expect(screen.getByRole("button", { name: /Row 1: round; column B/ })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: /Row 1: round; column B/ }));
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
  for (let i = 0; i < 9; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(
          `Row ${Math.floor(i / 3) + 1}: ${rows[Math.floor(i / 3)]}; column ${"ABC"[i % 3]}:`,
        ),
      }),
    );
  }
  fireEvent.click(screen.getByRole("button", { name: "Check grid" }));
  expect(screen.getByRole("region", { name: "Cross Exposure result" })).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("9 of 9");
});
it("offers hidden connections and fixed shots, preserves them when clearing, and reveals clues on request", () => {
  render(<PhotoCrossword photos={photos} />);
  expect(screen.getByRole("button", { name: "Hidden connections" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "4 starting photographs" }));
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  expect(screen.getAllByRole("button", { name: /fixed starting photograph/ })).toHaveLength(4);
  expect(screen.getByRole("button", { name: /Row 1; column A/ })).toBeDisabled();
  expect(
    within(screen.getByRole("group", { name: "Available photographs" })).getAllByRole("button"),
  ).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  fireEvent.click(screen.getByRole("button", { name: /Row 1; column C/ }));
  fireEvent.click(screen.getByRole("button", { name: "Clear grid" }));
  expect(screen.getAllByRole("button", { name: /fixed starting photograph/ })).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  expect(screen.getByRole("columnheader", { name: "scarlet" })).toHaveTextContent(/^scarlet$/);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(screen.getByRole("region", { name: "Cross Exposure result" })).toHaveFocus();
  expect(screen.getByRole("rowheader", { name: "round" })).toHaveTextContent(/^round$/);
});

it("starts hidden boards empty by default and offers exact additional fixed-photo counts", () => {
  render(<PhotoCrossword photos={photos} />);
  expect(screen.getByRole("button", { name: "0 starting photographs" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  expect(screen.queryByRole("button", { name: /fixed starting photograph/ })).toBeNull();
  expect(
    within(screen.getByRole("group", { name: "Available photographs" })).getAllByRole("button"),
  ).toHaveLength(9);
  for (const count of [1, 2, 3, 4]) {
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    fireEvent.click(screen.getByRole("button", { name: "Change grid size" }));
    fireEvent.click(screen.getByRole("button", { name: `${count} starting photographs` }));
    fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
    expect(screen.getAllByRole("button", { name: /fixed starting photograph/ })).toHaveLength(
      count,
    );
  }
});

it("offers 5×5 boards and defaults visible clues to no starting photographs", () => {
  const rowClues = Array.from({ length: 5 }, (_, index) => tag(`row_${index}`));
  const columnClues = Array.from({ length: 5 }, (_, index) => tag(`column_${index}`));
  const pool = rowClues.flatMap((row) =>
    columnClues.map((column) => ({
      ...photos[0]!,
      path: `${row.id}-${column.id}.jpg`,
      tags: `${row.id},${column.id}`,
    })),
  );
  jest.mocked(buildPhotoCrossword).mockReturnValue({
    size: 5,
    rows: rowClues,
    columns: columnClues,
    solution: pool,
    tiles: pool,
  });
  render(<PhotoCrossword photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Visible clues" }));
  expect(screen.getByRole("button", { name: "0 starting photographs" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "5×5" }));
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  expect(buildPhotoCrossword).toHaveBeenLastCalledWith(photos, 5);
  expect(screen.getAllByRole("button", { name: /; empty$/ })).toHaveLength(25);
  expect(
    within(screen.getByRole("group", { name: "Available photographs" })).getAllByRole("button"),
  ).toHaveLength(25);
});
it("reports an unavailable puzzle without inventing a board", () => {
  jest.mocked(buildPhotoCrossword).mockReturnValue(null);
  render(<PhotoCrossword photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
});

it("swaps two occupied squares without losing or duplicating a photograph", () => {
  startVisible();
  const first = () => screen.getByRole("button", { name: /Row 1: round; column A/ });
  const second = () => screen.getByRole("button", { name: /Row 1: round; column B/ });
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  fireEvent.click(first());
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  fireEvent.click(second());
  fireEvent.click(first());
  fireEvent.click(second());
  expect(within(first()).getByRole("img")).toHaveAttribute("alt", "round azure");
  expect(within(second()).getByRole("img")).toHaveAttribute("alt", "round scarlet");
  expect(
    within(screen.getByRole("group", { name: "Available photographs" })).getAllByRole("button"),
  ).toHaveLength(7);
});

it("accepts a hidden grid with inferred row order and reveals clues in that order", () => {
  render(<PhotoCrossword photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "0 starting photographs" }));
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  const remaining = [...photos];
  const reordered = [2, 0, 1].flatMap((row) => photos.slice(row * 3, (row + 1) * 3));
  for (let cell = 0; cell < reordered.length; cell++) {
    const index = remaining.findIndex((photo) => photo.path === reordered[cell]!.path);
    fireEvent.click(screen.getByRole("button", { name: `Select photograph ${index + 1}` }));
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(`Row ${Math.floor(cell / 3) + 1}; column ${"ABC"[cell % 3]};`),
      }),
    );
    remaining.splice(index, 1);
  }
  fireEvent.click(screen.getByRole("button", { name: "Check grid" }));
  expect(screen.getByRole("region", { name: "Cross Exposure result" })).toHaveFocus();
  expect(
    screen.getAllByRole("rowheader").map((header) => header.getAttribute("aria-label")),
  ).toEqual(["triangle", "round", "square"]);
});

it("does not judge individual squares against a secret ordering before hidden clues are revealed", () => {
  render(<PhotoCrossword photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "0 starting photographs" }));
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  fireEvent.click(screen.getByRole("button", { name: /Row 2; column B;/ }));
  fireEvent.click(screen.getByRole("button", { name: "Check grid" }));
  expect(
    within(screen.getByRole("table"))
      .getAllByRole("button")
      .every((button) => !button.hasAttribute("aria-invalid")),
  ).toBe(true);
  expect(screen.queryByRole("region", { name: "Cross Exposure result" })).toBeNull();
  for (let hint = 0; hint < 6; hint++)
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  fireEvent.click(screen.getByRole("button", { name: "Check grid" }));
  expect(screen.getByRole("button", { name: /Row 2: square; column B:/ })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

it("reveals one unique clue per hint without exposing other headers, cells or clue-key entries", () => {
  render(<PhotoCrossword photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  expect(
    screen.getAllByRole("rowheader").map((header) => header.getAttribute("aria-label")),
  ).toEqual(["round", "Row 2", "Row 3"]);
  expect(
    screen.getAllByRole("columnheader").map((header) => header.getAttribute("aria-label")),
  ).toEqual(["Column A", "Column B", "Column C"]);
  expect(screen.getByRole("button", { name: /Row 1: round; column A;/ })).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "Row clues" })).getAllByRole("listitem"),
  ).toHaveLength(1);
  expect(
    within(screen.getByRole("region", { name: "Column clues" })).queryByRole("listitem"),
  ).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("5 clues still hidden");
  fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  expect(screen.getByRole("columnheader", { name: "scarlet" })).toHaveTextContent(/^scarlet$/);
  expect(
    within(screen.getByRole("region", { name: "Row clues" })).getAllByRole("listitem"),
  ).toHaveLength(1);
  for (let hint = 2; hint < 6; hint++)
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  expect(screen.queryByRole("button", { name: "Hint" })).toBeNull();
  expect(
    within(screen.getByRole("region", { name: "Row clues" })).getAllByRole("listitem"),
  ).toHaveLength(3);
  expect(
    within(screen.getByRole("region", { name: "Column clues" })).getAllByRole("listitem"),
  ).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.getByRole("button", { name: "Hint" })).toHaveTextContent("6");
  expect(screen.queryByRole("rowheader", { name: "round" })).toBeNull();
});

// The second kind of hint puts a photograph in its place for the player: an
// empty square first, locked there like a starting photograph, and moved off
// whichever square the player had put it on.
it("places a photograph for the player as a hint, and locks it", () => {
  startVisible();
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  fireEvent.click(screen.getByRole("button", { name: /^Row 1: round; column B/ }));

  fireEvent.click(screen.getByRole("button", { name: "Place a photo" }));

  const placed = screen.getByRole("button", { name: /^Row 1: round; column A: scarlet/ });
  expect(placed).toHaveAccessibleName(/placed by a hint/);
  expect(placed).toBeDisabled();
  expect(within(placed).getByRole("img")).toHaveAttribute("src", expect.stringContaining("0-0"));
  expect(screen.getByRole("button", { name: /^Row 1: round; column B/ })).toHaveAccessibleName(
    /empty$/,
  );
});
it("stops placing photographs once every square holds its own", () => {
  startVisible();
  const place = screen.getByRole("button", { name: "Place a photo" });
  for (let i = 0; i < 9; i++) fireEvent.click(place);
  expect(screen.queryByRole("button", { name: "Place a photo" })).toBeNull();
});
it("saves lobby choices without restoring an active puzzle", () => {
  const { unmount } = render(<PhotoCrossword photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Visible clues" }));
  fireEvent.click(screen.getByRole("button", { name: "4 starting photographs" }));
  fireEvent.click(screen.getByRole("button", { name: "5×5" }));
  unmount();
  render(<PhotoCrossword photos={photos} />);
  expect(screen.getByRole("button", { name: "Visible clues" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "4 starting photographs" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "5×5" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("table")).toBeNull();
});

const dragTransfer = () => {
  const values = new Map<string, string>();
  return {
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? "",
    effectAllowed: "none",
    dropEffect: "none",
  };
};
it("drags a tray photograph into a square and swaps occupied squares without duplicates", () => {
  startVisible();
  const first = () => screen.getByRole("button", { name: /Row 1: round; column A/ });
  const second = () => screen.getByRole("button", { name: /Row 1: round; column B/ });
  const transfer = dragTransfer();
  const tile = screen.getByRole("button", { name: "Select photograph 1" });
  expect(tile).toHaveAttribute("draggable", "true");
  fireEvent.dragStart(tile, { dataTransfer: transfer });
  fireEvent.dragOver(first(), { dataTransfer: transfer });
  expect(transfer.dropEffect).toBe("move");
  fireEvent.drop(first(), { dataTransfer: transfer });
  expect(within(first()).getByRole("img")).toHaveAttribute("alt", "round scarlet");
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  fireEvent.click(second());
  fireEvent.dragStart(first(), { dataTransfer: transfer });
  fireEvent.drop(second(), { dataTransfer: transfer });
  expect(within(first()).getByRole("img")).toHaveAttribute("alt", "round azure");
  expect(within(second()).getByRole("img")).toHaveAttribute("alt", "round scarlet");
  expect(
    within(screen.getByRole("group", { name: "Available photographs" })).getAllByRole("button"),
  ).toHaveLength(7);
});
it("marks fixed photographs, rejects their drops and ignores unrelated dragged data", () => {
  render(<PhotoCrossword photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "1 starting photographs" }));
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  const fixed = screen.getByRole("button", { name: /Row 1; column A/ });
  expect(fixed).toHaveAttribute("draggable", "false");
  expect(within(fixed).getByText("Fixed")).toBeTruthy();
  const transfer = dragTransfer();
  fireEvent.dragStart(screen.getByRole("button", { name: "Select photograph 1" }), {
    dataTransfer: transfer,
  });
  fireEvent.drop(fixed, { dataTransfer: transfer });
  expect(within(fixed).getByRole("img")).toHaveAttribute("alt", "round scarlet");
  const empty = screen.getByRole("button", { name: /Row 1; column B/ });
  fireEvent.dragEnd(screen.getByRole("button", { name: "Select photograph 1" }));
  const unrelated = dragTransfer();
  unrelated.setData("text/plain", photos[1]!.path);
  fireEvent.drop(empty, { dataTransfer: unrelated });
  expect(within(empty).queryByRole("img")).toBeNull();
});

it("returns a placed photograph to the tray and clears a cancelled drag", () => {
  startVisible();
  const first = screen.getByRole("button", { name: /Row 1: round; column A/ });
  const tray = screen.getByRole("group", { name: "Available photographs" });
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  fireEvent.click(first);
  const transfer = dragTransfer();
  fireEvent.dragStart(first, { dataTransfer: transfer });
  fireEvent.drop(tray, { dataTransfer: transfer });
  expect(within(first).queryByRole("img")).toBeNull();
  expect(within(tray).getAllByRole("button")).toHaveLength(9);
  const tile = screen.getByRole("button", { name: "Select photograph 1" });
  fireEvent.dragStart(tile, { dataTransfer: transfer });
  fireEvent.dragEnd(tile);
  expect(tile).toHaveAttribute("aria-pressed", "false");
  fireEvent.drop(first, { dataTransfer: transfer });
  expect(within(first).queryByRole("img")).toBeNull();
  fireEvent.dragStart(tile, { dataTransfer: transfer });
  fireEvent.blur(window);
  expect(tile).toHaveAttribute("aria-pressed", "false");
  fireEvent.drop(first, { dataTransfer: transfer });
  expect(within(first).queryByRole("img")).toBeNull();
});
it("supports start, hints, cancellation, checking and give up shortcuts", () => {
  render(<PhotoCrossword photos={photos} />);
  fireEvent.keyDown(window, { key: "n" });
  expect(screen.getByRole("table")).toBeTruthy();
  fireEvent.keyDown(window, { key: "h" });
  expect(screen.getByRole("rowheader", { name: "round" })).toHaveTextContent(/^round$/);
  const tile = screen.getByRole("button", { name: "Select photograph 1" });
  fireEvent.click(tile);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(tile).toHaveAttribute("aria-pressed", "false");
  fireEvent.keyDown(window, { key: "Enter" });
  expect(screen.getByRole("status")).toHaveTextContent(/fit the hidden connections/);
  fireEvent.keyDown(window, { key: "g" });
  expect(screen.getByRole("region", { name: "Cross Exposure result" })).toHaveFocus();
  fireEvent.keyDown(window, { key: "n" });
  expect(screen.queryByRole("region", { name: "Cross Exposure result" })).toBeNull();
});

it("ignores the new-puzzle shortcut while a board is in progress", () => {
  startVisible();
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  const first = () => screen.getByRole("button", { name: /Row 1: round; column A/ });
  fireEvent.click(first());
  fireEvent.keyDown(window, { key: "n" });
  expect(within(first()).getByRole("img")).toHaveAttribute("alt", "round scarlet");
});

describe("daily", () => {
  const today = dailyPuzzle("cross-exposure");
  const dailyName = `Daily #${today.number}`;
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("deals the same board on every device, whatever order the archive arrives in", () => {
    jest
      .mocked(buildPhotoCrossword)
      .mockImplementation(jest.requireActual("../../util/photoCrossword").buildPhotoCrossword);
    const archive: PhotoGamePhoto[] = Array.from({ length: 6 }, (_, r) =>
      Array.from({ length: 6 }, (_, c) => ({
        path: `../albums/test-simple/${r}-${c}.jpg`,
        href: `/album/test-simple#${r}-${c}.jpg`,
        caption: "A photograph",
        tags: `row_${"abcdef"[r]},column_${"abcdef"[c]}`,
        vector: [],
      })),
    ).flat();
    const boardOf = (photos: PhotoGamePhoto[]) => {
      const board = dailyCrosswordPuzzle(photos, today.day)!;
      return {
        size: board.size,
        rows: board.rows.map((question) => question.id),
        columns: board.columns.map((question) => question.id),
        solution: board.solution.map((photo) => photo.path),
        tiles: board.tiles.map((photo) => photo.path),
      };
    };
    const first = boardOf(shuffleGamePhotos(archive, seededRandom("device one")));
    expect(first.size).toBe(4);
    expect(boardOf(shuffleGamePhotos(archive, seededRandom("device two")))).toEqual(first);
  });

  it("plays the fixed daily board without replacing saved settings", () => {
    const saved = { mode: "visible", prefill: 2, size: 5 };
    localStorage.setItem(gameSettingsStorageKey("cross"), JSON.stringify(saved));
    render(<PhotoCrossword photos={photos} />);
    fireEvent.click(screen.getByRole("button", { name: dailyName }));
    expect(jest.mocked(buildPhotoCrossword)).toHaveBeenLastCalledWith(
      expect.any(Array),
      4,
      expect.any(Function),
    );
    expect(screen.queryAllByRole("button", { name: /fixed starting photograph/ })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Hint" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    expect(JSON.parse(localStorage.getItem(gameSettingsStorageKey("cross"))!)).toEqual(saved);
    expect(window.location.search).toBe("?daily=");
  });

  it("records each finished game exactly once", () => {
    render(
      <StrictMode>
        <PhotoCrossword photos={photos} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Visible clues" }));
    fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    expect(readGameStats("cross-exposure")).toMatchObject({ played: 1, won: 0, dailies: {} });
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    for (let i = 0; i < 9; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
      fireEvent.click(
        screen.getByRole("button", {
          name: new RegExp(`^Row ${Math.floor(i / 3) + 1}: [a-z]+; column ${"ABC"[i % 3]}:`),
        }),
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "Check grid" }));
    expect(screen.getByRole("heading", { name: "Every clue crossed" })).toBeTruthy();
    expect(readGameStats("cross-exposure")).toMatchObject({ played: 2, won: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Change grid size" }));
    expect(screen.getByText(/Played 2 · won 1/)).toBeTruthy();
  });

  it("shares a finished daily and shows its result instead of offering it again", () => {
    render(<PhotoCrossword photos={photos} />);
    fireEvent.click(screen.getByRole("button", { name: dailyName }));
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    const result = screen.getByRole("region", { name: "Cross Exposure result" });
    expect(within(result).getByRole("button", { name: "Share result" })).toBeTruthy();
    expect(readGameStats("cross-exposure").dailies[today.day]).toEqual({
      won: false,
      summary: "3×3 · Gave up after 1 hint",
    });
    fireEvent.click(screen.getByRole("button", { name: "Change grid size" }));
    expect(screen.queryByRole("button", { name: dailyName })).toBeNull();
    expect(screen.getByText(`${dailyName} · 3×3 · Gave up after 1 hint`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share result" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start crossing" })).toBeEnabled();
  });

  it("counts a placed photograph among a daily's hints", () => {
    render(<PhotoCrossword photos={photos} />);
    fireEvent.click(screen.getByRole("button", { name: dailyName }));
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
    fireEvent.click(screen.getByRole("button", { name: "Place a photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    expect(readGameStats("cross-exposure").dailies[today.day]?.summary).toBe(
      "3×3 · Gave up after 2 hints",
    );
  });

  it("opens today's board from the URL, and its result once it is finished", () => {
    window.history.replaceState(null, "", "/fun/cross-exposure?daily");
    const first = render(<PhotoCrossword photos={photos} />);
    expect(screen.getByRole("region", { name: "Crossword board" })).toBeTruthy();
    first.unmount();
    localStorage.setItem(
      gameStatsStorageKey("cross-exposure"),
      JSON.stringify({
        played: 1,
        won: 1,
        streak: 1,
        bestStreak: 1,
        lastDay: today.day,
        dailies: { [today.day]: { won: true, summary: "4×4 · Solved with no hints" } },
      }),
    );
    render(<PhotoCrossword photos={photos} />);
    expect(screen.queryByRole("region", { name: "Crossword board" })).toBeNull();
    expect(screen.getByText(`${dailyName} · 4×4 · Solved with no hints`)).toBeTruthy();
  });
});

it("checks partial hidden grids without revealing clues or ending the round", () => {
  render(<PhotoCrossword photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  fireEvent.click(screen.getByRole("button", { name: /Row 2; column A;/ }));
  fireEvent.click(screen.getByRole("button", { name: "Check grid" }));
  expect(screen.getByRole("status")).toHaveTextContent(/fit the hidden connections/);
  expect(screen.queryByRole("region", { name: "Cross Exposure result" })).toBeNull();
  expect(screen.getByRole("rowheader", { name: "Row 2" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 4" }));
  fireEvent.click(screen.getByRole("button", { name: /Row 2; column B;/ }));
  fireEvent.click(screen.getByRole("button", { name: "Check grid" }));
  expect(screen.getByRole("status")).toHaveTextContent(/do not share a connection/);
  expect(screen.queryByRole("region", { name: "Cross Exposure result" })).toBeNull();
});
