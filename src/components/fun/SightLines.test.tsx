/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SightLines } from "./SightLines";
import { buildPhotoWordSearch } from "../../util/photoWordSearch";
import type { PhotoGamePhoto } from "../../util/photoGames";
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
  expect(within(result).getAllByRole("link")).toHaveLength(12);
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
