/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { buildDailyPhotoHangman, PhotoHangman } from "./PhotoHangman";
import { readGameStats } from "./useGameStats";
import { dailyNumber, localDayKey } from "../../util/gameDaily";
import { seededRandom } from "../../util/seededRandom";
import { shuffleGamePhotos } from "../../util/photoGames";
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
  localStorage.clear();
  window.history.replaceState(null, "", "/");
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
  expect(
    within(result)
      .getAllByRole("link")
      .filter((link) => link.querySelector("img")),
  ).toHaveLength(8);
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
  expect(
    within(result)
      .getAllByRole("link")
      .filter((link) => link.querySelector("img")),
  ).toHaveLength(8);
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

const loadClues = () => {
  for (const image of screen.queryAllByRole("img", { name: /^Photographic clue/ }))
    fireEvent.load(image);
};

describe("daily puzzle", () => {
  const today = localDayKey();
  const label = `Daily #${dailyNumber(today)}`;
  const shape = (puzzle: ReturnType<typeof buildDailyPhotoHangman>) => ({
    answer: puzzle!.answer,
    photos: puzzle!.photos.map((photo) => photo.path),
  });

  it("deals the same subject and clues however the archive arrives", () => {
    const first = buildDailyPhotoHangman(photos, "2026-10-20");
    jest.spyOn(Math, "random").mockReturnValue(0.91);
    const second = buildDailyPhotoHangman(
      shuffleGamePhotos(photos, seededRandom("another order")),
      "2026-10-20",
    );
    expect(first).not.toBeNull();
    expect(shape(second)).toEqual(shape(first));
    const days = ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"];
    expect(
      days.some((day) => shape(buildDailyPhotoHangman(photos, day)).answer !== first!.answer),
    ).toBe(true);
  });

  it("shares a spoiler-free result, records it once and shows it in the lobby afterwards", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const puzzle = buildDailyPhotoHangman(photos, today)!;
    const { unmount } = render(<PhotoHangman photos={[...photos].reverse()} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    loadClues();
    const wrong = puzzle.subjects.find((subject) => !puzzle.acceptedAnswers.includes(subject))!;
    fireEvent.click(screen.getByRole("button", { name: `Guess ${wrong.toLowerCase()}` }));
    loadClues();
    fireEvent.click(screen.getByRole("button", { name: `Guess ${puzzle.answer.toLowerCase()}` }));
    const result = screen.getByRole("region", { name: "Photo Hangman result" });
    await act(async () => {
      fireEvent.click(within(result).getByRole("button", { name: "Share result" }));
    });
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain(`Photo Hangman #${dailyNumber(today)}`);
    expect(text).toContain("Solved · 1 miss");
    for (const subject of [puzzle.answer, ...puzzle.acceptedAnswers])
      expect(text).not.toMatch(new RegExp(subject, "i"));
    expect(readGameStats("photo-hangman")).toMatchObject({ played: 1, won: 1, best: 5 });
    unmount();

    render(<PhotoHangman photos={photos} />);
    expect(screen.queryByRole("button", { name: label })).toBeNull();
    expect(screen.getByText(/Solved · 1 miss/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share result" })).toBeTruthy();
    expect(screen.getByText("Played 1 · won 1 · best 1 miss")).toBeTruthy();
  });

  it("opens straight into the daily from ?daily, and shows the result once it is finished", () => {
    window.history.replaceState(null, "", "/fun/photo-hangman?daily");
    const puzzle = buildDailyPhotoHangman(photos, today)!;
    const { unmount, rerender } = render(<PhotoHangman photos={[]} />);
    expect(screen.queryByRole("group", { name: "Subject choices" })).toBeNull();
    rerender(<PhotoHangman photos={photos} />);
    loadClues();
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    expect(
      within(screen.getByRole("region", { name: "Photo Hangman result" })).getByText(
        new RegExp(puzzle.answer, "i"),
      ),
    ).toBeTruthy();
    unmount();
    render(<PhotoHangman photos={photos} />);
    expect(screen.queryByRole("group", { name: "Subject choices" })).toBeNull();
    expect(screen.getByText(/Not solved · 0 misses/)).toBeTruthy();
    expect(readGameStats("photo-hangman")).toMatchObject({ played: 1, won: 0 });
  });
});

it("records an ordinary game once, with no daily", () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  fireEvent.keyDown(window, { key: "g" });
  expect(readGameStats("photo-hangman")).toMatchObject({ played: 1, won: 0, dailies: {} });
  expect(readGameStats("photo-hangman").best).toBeUndefined();
});
