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
  expect(screen.getByRole("heading", { name: "5 turns for 4 pairs" })).toBeInTheDocument();
  expect(readGameStats("photo-pairs").played).toBe(1);
  fireEvent.click(card(0));
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
