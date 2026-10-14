/** @jest-environment jsdom */
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { PhotoHangman } from "./PhotoHangman";
import { buildPhotoHangman } from "../../util/photoHangman";
jest.mock("../../util/photoHangman", () => {
  const actual = jest.requireActual("../../util/photoHangman");
  return { ...actual, buildPhotoHangman: jest.fn(actual.buildPhotoHangman) };
});
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
  Array.from({ length: 8 }, (_, i) => ({
    path: `${subject}-${i}.jpg`,
    href: `/album/test-simple#${subject}-${i}`,
    caption: subject,
    tags: subject,
    vector: [],
  })),
);
const { buildPhotoHangman: buildActual } =
  jest.requireActual<typeof import("../../util/photoHangman")>("../../util/photoHangman");
beforeEach(() => {
  jest.spyOn(Math, "random").mockReturnValue(0.37);
  jest.mocked(buildPhotoHangman).mockImplementation(buildActual);
});
afterEach(() => jest.restoreAllMocks());
const start = () => {
  render(<PhotoHangman photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start guessing" }));
  fireEvent.load(screen.getByRole("img", { name: "Photographic clue 1" }));
  fireEvent.load(screen.getByRole("img", { name: "Photographic clue 2" }));
};
it("offers subject tags, filters without guessing, and reveals linked clues after a correct choice", async () => {
  const puzzle = buildActual(photos, () => 0.37)!;
  start();
  expect(screen.getByRole("img", { name: "Photographic clue 1" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Photographic clue 2" })).toBeTruthy();
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
  expect(within(result).getAllByRole("link")).toHaveLength(8);
  expect(within(result).getByText(new RegExp(puzzle.answer, "i"))).toBeTruthy();
});
it("each wrong tag reveals a new clue, used choices stay disabled, and six misses end the round", async () => {
  const puzzle = buildActual(photos, () => 0.37)!;
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
  expect(within(result).getAllByRole("link")).toHaveLength(8);
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
  fireEvent.load(screen.getByRole("img", { name: "Photographic clue 2" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry photograph" }));
  fireEvent.load(screen.getByRole("img", { name: "Photographic clue 1" }));
  fireEvent.load(screen.getByRole("img", { name: "Photographic clue 2" }));
  expect(
    within(bank)
      .getAllByRole("button")
      .some((button) => !button.hasAttribute("disabled")),
  ).toBe(true);
});

it("waits for both starting photographs before accepting a guess", () => {
  render(<PhotoHangman photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start guessing" }));
  const bank = screen.getByRole("group", { name: "Subject choices" });
  fireEvent.load(screen.getByRole("img", { name: "Photographic clue 1" }));
  expect(
    within(bank)
      .getAllByRole("button")
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
  fireEvent.load(screen.getByRole("img", { name: "Photographic clue 2" }));
  expect(
    within(bank)
      .getAllByRole("button")
      .every((button) => !button.hasAttribute("disabled")),
  ).toBe(true);
});

it("moves focus to the next open subject once a wrong guess's clue has loaded", () => {
  const puzzle = buildActual(photos, () => 0.37)!;
  start();
  const wrong = puzzle.subjects.find((subject) => !puzzle.acceptedAnswers.includes(subject))!;
  const choice = screen.getByRole("button", { name: `Guess ${wrong.toLowerCase()}` });
  choice.focus();
  fireEvent.click(choice);
  fireEvent.load(
    within(screen.getByRole("figure", { name: "Current photographic clue" })).getByRole("img"),
  );
  const focused = document.activeElement as HTMLElement;
  expect(
    within(screen.getByRole("group", { name: "Subject choices" })).getAllByRole("button"),
  ).toContain(focused);
  expect(focused).toBeEnabled();
});

it("loads the next round's clues afresh even when one was showing on the result screen", () => {
  const puzzle = buildActual(photos, () => 0.37)!;
  jest.mocked(buildPhotoHangman).mockReturnValue(puzzle);
  start();
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  const shown = within(screen.getByRole("figure", { name: "Current photographic clue" })).getByRole(
    "img",
  );
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  // A reused element with an unchanged source never fires another load event.
  expect(screen.getByRole("img", { name: "Photographic clue 2" })).not.toBe(shown);
});
