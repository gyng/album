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
