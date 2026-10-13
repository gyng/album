/** @jest-environment jsdom */
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { PhotoHangman } from "./PhotoHangman";
import { buildPhotoHangman } from "../../util/photoHangman";
import type { PhotoGamePhoto } from "../../util/photoGames";
const photos: PhotoGamePhoto[] = [
  "cat",
  "dog",
  "train",
  "bridge",
  "window",
  "chair",
  "bicycle",
  "boat",
].flatMap((subject) =>
  Array.from({ length: 7 }, (_, i) => ({
    path: `${subject}-${i}.jpg`,
    href: `/album/test-simple#${subject}-${i}`,
    caption: subject,
    tags: subject,
    vector: [],
  })),
);
beforeEach(() => jest.spyOn(Math, "random").mockReturnValue(0.37));
afterEach(() => jest.restoreAllMocks());
const start = () => {
  render(<PhotoHangman photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start guessing" }));
  fireEvent.load(screen.getByRole("img", { name: "Photographic clue 1" }));
};
it("offers subject tags, filters without guessing, and reveals linked clues after a correct choice", async () => {
  const puzzle = buildPhotoHangman(photos, () => 0.37)!;
  start();
  expect(screen.getByRole("img", { name: "Photographic clue 1" })).toBeTruthy();
  expect(screen.queryByText(puzzle.answer)).toBeNull();
  const bank = screen.getByRole("group", { name: "Subject choices" });
  expect(within(bank).getAllByRole("button")).toHaveLength(puzzle.subjects.length);
  fireEvent.change(screen.getByRole("searchbox", { name: "Filter subjects" }), {
    target: { value: puzzle.answer.toLowerCase() },
  });
  expect(screen.getByText("6 misses left")).toBeTruthy();
  fireEvent.click(
    within(bank).getByRole("button", { name: `Guess ${puzzle.answer.toLowerCase()}` }),
  );
  const result = screen.getByRole("region", { name: "Photo Hangman result" });
  await waitFor(() => expect(result).toHaveFocus());
  expect(within(result).getAllByRole("link")).toHaveLength(7);
  expect(within(result).getByText(new RegExp(puzzle.answer, "i"))).toBeTruthy();
});
it("each wrong tag reveals a new clue, used choices stay disabled, and six misses end the round", async () => {
  const puzzle = buildPhotoHangman(photos, () => 0.37)!;
  start();
  const wrong = puzzle.subjects
    .filter((subject) => !puzzle.acceptedAnswers.includes(subject))
    .slice(0, 6);
  for (const [index, subject] of wrong.entries()) {
    const choice = screen.getByRole("button", { name: `Guess ${subject.toLowerCase()}` });
    fireEvent.click(choice);
    if (index < 5) expect(choice).toBeDisabled();
    const photo = within(
      screen.getByRole("figure", { name: "Current photographic clue" }),
    ).getByRole("img");
    fireEvent.load(photo);
  }
  const result = screen.getByRole("region", { name: "Photo Hangman result" });
  await waitFor(() => expect(result).toHaveFocus());
  expect(within(result).getAllByRole("link")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.queryByRole("region", { name: "Photo Hangman result" })).toBeNull();
  expect(screen.getByText("6 misses left")).toBeTruthy();
});
it("prevents guesses while the photo loads and lets players retry a failed clue", () => {
  render(<PhotoHangman photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start guessing" }));
  const bank = screen.getByRole("group", { name: "Subject choices" });
  expect(
    within(bank)
      .getAllByRole("button")
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
  fireEvent.error(screen.getByRole("img", { name: "Photographic clue 1" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry photograph" }));
  fireEvent.load(screen.getByRole("img", { name: "Photographic clue 1" }));
  expect(
    within(bank)
      .getAllByRole("button")
      .some((button) => !button.hasAttribute("disabled")),
  ).toBe(true);
});
