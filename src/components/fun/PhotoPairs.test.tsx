/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { PhotoPairs } from "./PhotoPairs";
import { buildPhotoPairs } from "../../util/photoPairs";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { readGameStats } from "./useGameStats";
jest.mock("../../util/photoPairs", () => ({
  ...jest.requireActual("../../util/photoPairs"),
  buildPhotoPairs: jest.fn(),
}));
const photos: PhotoGamePhoto[] = Array.from({ length: 8 }, (_, i) => ({
  path: `../albums/test-simple/${i}.jpg`,
  href: `/album/test-simple#${i}`,
  caption: `Secret subject ${i}`,
  tags: "",
  vector: [1],
}));
beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
  jest
    .mocked(buildPhotoPairs)
    .mockReturnValue(photos.map((photo, i) => ({ photo, pair: Math.floor(i / 2) })));
});
afterEach(() => jest.useRealTimers());
it("keeps hidden captions out of the accessible tree, holds a miss, then records completion once", () => {
  render(<PhotoPairs photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start matching" }));
  const board = screen.getByLabelText("Matching cards");
  expect(within(board).queryAllByRole("img")).toHaveLength(0);
  const card = (n: number) => within(board).getAllByRole("button")[n]!;
  fireEvent.click(card(0));
  expect(within(board).getByRole("img", { name: "Secret subject 0" })).toBeInTheDocument();
  fireEvent.click(card(2));
  fireEvent.click(card(4));
  expect(within(board).queryByRole("img", { name: "Secret subject 4" })).toBeNull();
  act(() => jest.advanceTimersByTime(1400));
  expect(within(board).getAllByRole("img")).toHaveLength(2);
  for (const image of within(board).getAllByRole("img")) fireEvent.load(image);
  act(() => jest.advanceTimersByTime(1400));
  expect(within(board).queryAllByRole("img")).toHaveLength(0);
  for (let i = 0; i < 8; i++) fireEvent.click(card(i));
  expect(screen.getByRole("status")).toHaveTextContent("All pairs found in 5 turns.");
  expect(readGameStats("photo-pairs").played).toBe(1);
  expect(within(board).getAllByRole("link")).toHaveLength(8);
  expect(readGameStats("photo-pairs").played).toBe(1);
});
it("one glimpse shows the board once and then hides it", () => {
  render(<PhotoPairs photos={photos} />);
  fireEvent.click(screen.getByRole("radio", { name: "One glimpse" }));
  fireEvent.click(screen.getByRole("button", { name: "Start matching" }));
  const board = screen.getByLabelText("Matching cards");
  expect(within(board).getAllByRole("img")).toHaveLength(8);
  for (const image of within(board).getAllByRole("img")) fireEvent.load(image);
  act(() => jest.advanceTimersByTime(3000));
  expect(within(board).queryAllByRole("img")).toHaveLength(0);
});

it.each([
  ["5×5", 12, 1],
  ["6×6", 18, 0],
  ["7×7", 24, 1],
] as const)(
  "starts a %s board with complete pairs and an empty centre when needed",
  (label, pairs, blanks) => {
    jest.mocked(buildPhotoPairs).mockImplementation((_photos, count) =>
      Array.from({ length: count * 2 }, (_, i) => ({
        photo: { ...photos[0]!, path: `large-${i}` },
        pair: Math.floor(i / 2),
      })),
    );
    render(<PhotoPairs photos={photos} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: "Start matching" }));
    const board = screen.getByLabelText("Matching cards");
    expect(within(board).getAllByRole("button")).toHaveLength(pairs * 2);
    expect(within(board).queryAllByLabelText("Empty centre square")).toHaveLength(blanks);
    if (blanks) expect(board.children[pairs]).toHaveAttribute("aria-label", "Empty centre square");
    expect(buildPhotoPairs).toHaveBeenCalledWith(photos, pairs, "visual", Math.random, 2);
  },
);

it.each([3, 4] as const)(
  "checks all %i selected photographs together and completes the board",
  (matchSize) => {
    jest.mocked(buildPhotoPairs).mockImplementation((_photos, count) =>
      Array.from({ length: count * matchSize }, (_, i) => ({
        photo: { ...photos[0]!, path: `multi-${i}`, caption: `Photo ${i}` },
        pair: Math.floor(i / matchSize),
      })),
    );
    render(<PhotoPairs photos={photos} />);
    expect(screen.getByRole("radio", { name: "Match 2" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: `Match ${matchSize}` }));
    fireEvent.click(screen.getByRole("button", { name: "Start matching" }));
    const board = screen.getByLabelText("Matching cards");
    const cards = within(board).getAllByRole("button");
    expect(cards).toHaveLength(12);
    for (let i = 0; i < matchSize - 1; i++) fireEvent.click(cards[i]!);
    expect(screen.getByRole("status")).toHaveTextContent(`Choose ${matchSize} cards`);
    fireEvent.click(cards[matchSize - 1]!);
    expect(cards[0]).toHaveAccessibleName(/matched/);
    for (let i = matchSize; i < cards.length; i++) fireEvent.click(cards[i]!);
    expect(screen.getByRole("status")).toHaveTextContent(
      `All matches found in ${12 / matchSize} turns.`,
    );
    expect(within(board).getAllByRole("link")).toHaveLength(12);
  },
);
