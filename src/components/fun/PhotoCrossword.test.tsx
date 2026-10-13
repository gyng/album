/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PhotoCrossword } from "./PhotoCrossword";
import { buildPhotoCrossword, type PhotoCrosswordPuzzle } from "../../util/photoCrossword";
import type { PhotoGamePhoto, OracleQuestion } from "../../util/photoGames";
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
  fireEvent.click(screen.getByRole("button", { name: /Row 1: round; column 2/ }));
  fireEvent.click(screen.getByRole("button", { name: "Check grid" }));
  expect(screen.getByRole("button", { name: /Row 1: round; column 2/ })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: /Row 1: round; column 2/ }));
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
  for (let i = 0; i < 9; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(
          `Row ${Math.floor(i / 3) + 1}: ${rows[Math.floor(i / 3)]}; column ${(i % 3) + 1}:`,
        ),
      }),
    );
  }
  fireEvent.click(screen.getByRole("button", { name: "Check grid" }));
  expect(screen.getByRole("region", { name: "Cross Exposure result" })).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("9 of 9");
});
it("starts with hidden connections and fixed seed pairs, preserves them when clearing, and reveals clues on request", () => {
  render(<PhotoCrossword photos={photos} />);
  expect(screen.getByRole("button", { name: "Hidden connections" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Guided" }));
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  expect(screen.getAllByRole("button", { name: /fixed starting photograph/ })).toHaveLength(6);
  expect(screen.getByRole("button", { name: /Row 1; column 1/ })).toBeDisabled();
  expect(
    within(screen.getByRole("group", { name: "Available photographs" })).getAllByRole("button"),
  ).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  fireEvent.click(screen.getByRole("button", { name: /Row 1; column 3/ }));
  fireEvent.click(screen.getByRole("button", { name: "Clear grid" }));
  expect(screen.getAllByRole("button", { name: /fixed starting photograph/ })).toHaveLength(6);
  fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  expect(screen.getByRole("columnheader", { name: "scarlet" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(screen.getByRole("region", { name: "Cross Exposure result" })).toHaveFocus();
  expect(screen.getByRole("rowheader", { name: "round" })).toBeTruthy();
});

it("defaults to minimal hidden seeds and offers a fully empty hidden board", () => {
  render(<PhotoCrossword photos={photos} />);
  expect(screen.getByRole("button", { name: "Minimal" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  expect(screen.getAllByRole("button", { name: /fixed starting photograph/ })).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  fireEvent.click(screen.getByRole("button", { name: "Change grid size" }));
  fireEvent.click(screen.getByRole("button", { name: "None" }));
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  expect(screen.queryByRole("button", { name: /fixed starting photograph/ })).toBeNull();
  expect(
    within(screen.getByRole("group", { name: "Available photographs" })).getAllByRole("button"),
  ).toHaveLength(9);
  expect(
    screen.getAllByRole("columnheader").map((header) => header.getAttribute("aria-label")),
  ).toEqual(["Column 1", "Column 2", "Column 3"]);
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
  expect(screen.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
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
  const first = () => screen.getByRole("button", { name: /Row 1: round; column 1/ });
  const second = () => screen.getByRole("button", { name: /Row 1: round; column 2/ });
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
  fireEvent.click(screen.getByRole("button", { name: "None" }));
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  const remaining = [...photos];
  const reordered = [2, 0, 1].flatMap((row) => photos.slice(row * 3, (row + 1) * 3));
  for (let cell = 0; cell < reordered.length; cell++) {
    const index = remaining.findIndex((photo) => photo.path === reordered[cell]!.path);
    fireEvent.click(screen.getByRole("button", { name: `Select photograph ${index + 1}` }));
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(`Row ${Math.floor(cell / 3) + 1}; column ${(cell % 3) + 1};`),
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
  fireEvent.click(screen.getByRole("button", { name: "None" }));
  fireEvent.click(screen.getByRole("button", { name: "Start crossing" }));
  fireEvent.click(screen.getByRole("button", { name: "Select photograph 1" }));
  fireEvent.click(screen.getByRole("button", { name: /Row 2; column 2;/ }));
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
  expect(screen.getByRole("button", { name: /Row 2: square; column 2:/ })).toHaveAttribute(
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
  ).toEqual(["Column 1", "Column 2", "Column 3"]);
  expect(screen.getByRole("button", { name: /Row 1: round; column 1;/ })).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "Row clues" })).getAllByRole("listitem"),
  ).toHaveLength(1);
  expect(
    within(screen.getByRole("region", { name: "Column clues" })).queryByRole("listitem"),
  ).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("5 clues still hidden");
  fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  expect(screen.getByRole("columnheader", { name: "scarlet" })).toBeTruthy();
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

it("saves lobby choices without restoring an active puzzle", () => {
  const { unmount } = render(<PhotoCrossword photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Visible clues" }));
  fireEvent.click(screen.getByRole("button", { name: "Guided" }));
  fireEvent.click(screen.getByRole("button", { name: "5×5" }));
  unmount();
  render(<PhotoCrossword photos={photos} />);
  expect(screen.getByRole("button", { name: "Visible clues" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "Guided" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "5×5" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("table")).toBeNull();
});
