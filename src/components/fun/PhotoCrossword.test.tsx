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
beforeEach(() => jest.mocked(buildPhotoCrossword).mockReturnValue(puzzle));
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
  fireEvent.click(screen.getByRole("button", { name: "Reveal clues" }));
  expect(screen.getByRole("columnheader", { name: "scarlet" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(screen.getByRole("region", { name: "Cross Exposure result" })).toHaveFocus();
  expect(screen.getByRole("rowheader", { name: "round" })).toBeTruthy();
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
