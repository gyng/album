/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { buildDailySightLines, SightLines } from "./SightLines";
import { readGameStats } from "./useGameStats";
import { buildPhotoWordSearch } from "../../util/photoWordSearch";
import { dailyNumber, localDayKey } from "../../util/gameDaily";
import { seededRandom } from "../../util/seededRandom";
import { shuffleGamePhotos, type PhotoGamePhoto } from "../../util/photoGames";
const photos: PhotoGamePhoto[] = ["cat", "bicycle", "boat", "umbrella", "stairs", "clock"].flatMap(
  (tag) =>
    Array.from({ length: 12 }, (_, i) => ({
      path: `${tag}-${i}.jpg`,
      href: "/album/test-simple",
      caption: tag,
      tags: tag,
      vector: [],
    })),
);
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  jest.spyOn(Math, "random").mockReturnValue(0.37);
});
afterEach(() => jest.restoreAllMocks());
it("lets keyboard users select endpoints and finish all four sight lines", () => {
  const puzzle = buildPhotoWordSearch(photos, 5, () => 0.37)!;
  render(<SightLines photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start searching" }));
  const board = screen.getByRole("group", { name: "Photo search board" });
  const targets = screen.getByRole("region", { name: "Search targets" });
  expect(within(targets).getAllByRole("listitem")).toHaveLength(4);
  for (const target of puzzle.targets)
    expect(within(targets).getByLabelText(`${target.label}: still to find`)).toBeTruthy();
  for (const target of puzzle.targets) {
    const cells = within(board).getAllByRole("button");
    fireEvent.click(cells[target.cells[0]!]!);
    fireEvent.click(cells[target.cells[2]!]!);
    expect(within(targets).getByLabelText(`${target.label}: found`)).toBeTruthy();
  }
  expect(screen.getByRole("status")).toHaveTextContent(/Every sight line found/);
  expect(screen.getByRole("region", { name: "Sight Lines result" })).toBeTruthy();
  expect(
    within(board)
      .getAllByRole("button")
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.queryByRole("region", { name: "Sight Lines result" })).toBeNull();
});
it("hints identify a starting cell, rejects non-lines, and reveals photos on giving up", async () => {
  render(<SightLines photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start searching" }));
  fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  const board = screen.getByRole("group", { name: "Photo search board" });
  expect(within(board).getByRole("button", { name: /hint starts here/ })).toBeTruthy();
  const cells = within(board).getAllByRole("button");
  fireEvent.click(cells[0]!);
  fireEvent.click(cells[7]!);
  expect(screen.getByRole("status")).toHaveTextContent(/straight line/);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  const result = screen.getByRole("region", { name: "Sight Lines result" });
  await waitFor(() => expect(result).toHaveFocus());
  expect(within(board).getAllByRole("button", { name: /revealed/ })).toHaveLength(12);
  expect(
    within(result)
      .getAllByRole("link")
      .filter((link) => link.querySelector("img")),
  ).toHaveLength(12);
});

it("starts the advanced board with longer lines and supports arrow navigation and shortcuts", async () => {
  const archive = photos.flatMap((photo) => [photo, { ...photo, path: photo.path + "-extra" }]);
  render(<SightLines photos={archive} />);
  fireEvent.click(screen.getByRole("button", { name: "10×10" }));
  fireEvent.click(screen.getByRole("button", { name: "5 per line" }));
  fireEvent.keyDown(window, { key: "n" });
  const board = screen.getByRole("group", { name: "Photo search board" });
  expect(within(board).getAllByRole("button")).toHaveLength(100);
  const first = within(board).getByRole("button", { name: "Row 1, column 1" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowRight" });
  const second = within(board).getByRole("button", { name: "Row 1, column 2" });
  expect(second).toHaveFocus();
  fireEvent.keyDown(second, { key: "ArrowDown" });
  expect(within(board).getByRole("button", { name: "Row 2, column 2" })).toHaveFocus();
  fireEvent.keyDown(window, { key: "h" });
  expect(within(board).getByRole("button", { name: /hint starts here/ })).toBeTruthy();
  fireEvent.keyDown(window, { key: "g" });
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Sight Lines result" })).toHaveFocus(),
  );
});

it("stops arrow navigation at the edges of the board", () => {
  render(<SightLines photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "5×5" }));
  fireEvent.click(screen.getByRole("button", { name: "Start searching" }));
  const board = screen.getByRole("group", { name: "Photo search board" });
  const cell = (row: number, column: number) =>
    within(board).getByRole("button", { name: new RegExp(`^Row ${row}, column ${column}\\b`) });
  for (const [row, column, key] of [
    [1, 3, "ArrowUp"],
    [5, 2, "ArrowDown"],
    [1, 5, "ArrowRight"],
    [2, 1, "ArrowLeft"],
  ] as const) {
    cell(row, column).focus();
    fireEvent.keyDown(cell(row, column), { key });
    expect(cell(row, column)).toHaveFocus();
  }
});

describe("daily board", () => {
  const today = localDayKey();
  const label = `Daily #${dailyNumber(today)}`;
  const boardOf = (puzzle: ReturnType<typeof buildDailySightLines>) => ({
    tiles: puzzle!.tiles.map((photo) => photo.path),
    targets: puzzle!.targets.map((target) => [target.id, target.cells]),
  });
  const solve = (puzzle: NonNullable<ReturnType<typeof buildDailySightLines>>) => {
    const board = screen.getByRole("group", { name: "Photo search board" });
    for (const target of puzzle.targets) {
      const cells = within(board).getAllByRole("button");
      fireEvent.click(cells[target.cells[0]!]!);
      fireEvent.click(cells[target.cells.at(-1)!]!);
    }
  };

  it("deals the same board however the archive arrives and whatever Math.random does", () => {
    const shuffled = shuffleGamePhotos(photos, seededRandom("another order"));
    const first = buildDailySightLines(photos, "2026-10-20");
    jest.spyOn(Math, "random").mockReturnValue(0.91);
    const second = buildDailySightLines([...shuffled].reverse(), "2026-10-20");
    expect(first).not.toBeNull();
    expect(first!.size).toBe(6);
    expect(first!.lineLength).toBe(4);
    expect(boardOf(second)).toEqual(boardOf(first));
    // An ordinary game played first must not shape the daily.
    buildPhotoWordSearch(shuffled, 6, Math.random, 4);
    expect(boardOf(buildDailySightLines(shuffled, "2026-10-20"))).toEqual(boardOf(first));
    expect(boardOf(buildDailySightLines(photos, "2026-10-21"))).not.toEqual(boardOf(first));
  });

  it("plays today's fixed board from the lobby without changing saved settings, then shares it", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    localStorage.setItem(
      "snapshots-fun-settings-v1:sightLines",
      JSON.stringify({ size: 5, lineLength: 3 }),
    );
    const puzzle = buildDailySightLines(photos, today)!;
    const { unmount } = render(<SightLines photos={[...photos].reverse()} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    const board = screen.getByRole("group", { name: "Photo search board" });
    expect(within(board).getAllByRole("button")).toHaveLength(36);
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
    solve(puzzle);
    const result = screen.getByRole("region", { name: "Sight Lines result" });
    await act(async () => {
      fireEvent.click(within(result).getByRole("button", { name: "Share result" }));
    });
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain(`Sight Lines #${dailyNumber(today)}`);
    expect(text).toContain("6×6 · 4/4 lines · 1 hint");
    for (const target of puzzle.targets) expect(text).not.toMatch(new RegExp(target.label, "i"));
    expect(JSON.parse(localStorage.getItem("snapshots-fun-settings-v1:sightLines")!)).toEqual({
      size: 5,
      lineLength: 3,
    });
    expect(readGameStats("sight-lines")).toMatchObject({ played: 1, won: 1 });
    unmount();

    // The lobby now shows today's result instead of offering the daily again.
    render(<SightLines photos={photos} />);
    expect(screen.queryByRole("button", { name: label })).toBeNull();
    expect(screen.getByText(/4\/4 lines · 1 hint/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share result" })).toBeTruthy();
    expect(screen.getByText("Played 1 · won 1")).toBeTruthy();
  });

  it("opens straight into the daily from ?daily, and shows the result once it is finished", () => {
    window.history.replaceState(null, "", "/fun/sight-lines?daily");
    const puzzle = buildDailySightLines(photos, today)!;
    const { unmount } = render(<SightLines photos={photos} />);
    const board = screen.getByRole("group", { name: "Photo search board" });
    expect(within(board).getAllByRole("button")).toHaveLength(36);
    solve(puzzle);
    unmount();
    render(<SightLines photos={photos} />);
    expect(screen.queryByRole("group", { name: "Photo search board" })).toBeNull();
    expect(screen.getByText(/4\/4 lines · no hints/)).toBeTruthy();
    expect(readGameStats("sight-lines").played).toBe(1);
  });

  it("waits for the archive before dealing a linked daily", () => {
    window.history.replaceState(null, "", "/fun/sight-lines?daily");
    const { rerender } = render(<SightLines photos={[]} />);
    expect(screen.queryByRole("group", { name: "Photo search board" })).toBeNull();
    rerender(<SightLines photos={photos} />);
    expect(screen.getByRole("group", { name: "Photo search board" })).toBeTruthy();
  });
});

it("records each finished game once and summarises it in the lobby", () => {
  const { unmount } = render(<SightLines photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start searching" }));
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  fireEvent.keyDown(window, { key: "g" });
  expect(readGameStats("sight-lines")).toMatchObject({ played: 1, won: 0 });
  expect(readGameStats("sight-lines").dailies).toEqual({});
  unmount();
  render(<SightLines photos={photos} />);
  expect(screen.getByText("Played 1 · won 0")).toBeTruthy();
});
