/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Warmer } from "./Warmer";
import { encodeSearchText } from "../search/textEmbeddings";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { localDayKey } from "../../util/gameDaily";
import { dailyPhotoOrder, dailyPuzzle } from "./GameRecord";
import { readGameStats } from "./useGameStats";

jest.mock("../search/textEmbeddings", () => ({ encodeSearchText: jest.fn() }));

const SIZE = 40;
const oneHot = (index: number): number[] =>
  Array.from({ length: SIZE }, (_, i) => (i === index ? 1 : 0));
const photos: PhotoGamePhoto[] = Array.from({ length: SIZE }, (_, i) => ({
  path: `../albums/test-simple/photo-${i}.jpg`,
  href: `/album/test-simple#photo-${i}.jpg`,
  caption: `Archive photograph number ${i} of the test set.`,
  tags: "",
  vector: oneHot(i),
}));

const hidden = () => screen.getByRole("img", { name: "The hidden photograph, pixelated" });
const targetIndex = () => Number(/photo-(\d+)/.exec(hidden().getAttribute("data-photo")!)![1]);
/** "exact" points at the hidden photograph; anything else points away from it. */
const answerWith = (target: number) =>
  jest.mocked(encodeSearchText).mockImplementation(async (text) => {
    if (text === "exact") return oneHot(target);
    const away: number[] = oneHot((target + 1) % SIZE);
    away[target] = -0.5;
    return away;
  });
const guess = async (text: string) => {
  fireEvent.change(screen.getByLabelText("What is in the photograph?"), {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Guess" }));
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/fun/warmer");
});

it("ranks each guess against the archive, sharpens the picture with every guess and reveals the photograph when found", async () => {
  render(<Warmer photos={photos} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /^Start Warmer/ }));
  answerWith(targetIndex());

  const blocks = () => Number(hidden().getAttribute("width"));
  const before = blocks();
  await guess("far away");
  const list = screen.getByRole("list", { name: "Your guesses, closest first" });
  expect(within(list).getByText("far away")).toBeInTheDocument();
  expect(within(list).getByText("Freezing")).toBeInTheDocument();
  expect(within(list).getByText(`#${SIZE} of ${SIZE}`)).toBeInTheDocument();
  // Even a freezing guess sharpens the picture: it follows the count, not the luck.
  expect(blocks()).toBeGreaterThan(before);

  await guess("exact");
  const result = screen.getByRole("region", { name: "Warmer result" });
  expect(result).toHaveFocus();
  expect(within(result).getByText("Found in 2 guesses")).toBeInTheDocument();
  expect(readGameStats("warmer")).toMatchObject({ played: 1, won: 1 });
});

it("does not spend a guess on words already tried", async () => {
  render(<Warmer photos={photos} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /^Start Warmer/ }));
  answerWith(targetIndex());
  await guess("far away");
  await guess("  Far  Away ");
  expect(encodeSearchText).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert")).toHaveTextContent("You already tried “far away”.");
});

it("records giving up as a loss and shows the hidden photograph", async () => {
  render(<Warmer photos={photos} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /^Start Warmer/ }));
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  const result = screen.getByRole("region", { name: "Warmer result" });
  expect(within(result).getByRole("link", { name: /^Archive photograph/ })).toHaveAttribute(
    "href",
    expect.stringMatching(/^\/album\/test-simple#photo-\d+\.jpg$/),
  );
  expect(readGameStats("warmer")).toMatchObject({ played: 1, won: 0 });
});

it("deals the same daily photograph from any archive order and keeps its result", async () => {
  window.history.replaceState(null, "", "/fun/warmer?daily");
  render(<Warmer photos={[...photos].reverse()} />);
  await act(async () => {});
  const today = dailyPuzzle("warmer");
  const order = dailyPhotoOrder(photos);
  const expected = order[Math.floor(today.random()() * order.length)]!;
  expect(hidden().getAttribute("data-photo")).toContain(expected.path.split("/").at(-1)!);
  answerWith(targetIndex());
  await guess("exact");
  expect(readGameStats("warmer").dailies[localDayKey()]).toMatchObject({
    won: true,
    summary: "Found in 1 guess",
  });
});

it("refuses a guess longer than the level allows before loading the model", async () => {
  render(<Warmer photos={photos} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /^Start Warmer/ }));
  await guess("red bicycle by the canal");
  expect(screen.getByRole("alert")).toHaveTextContent("Two words at most per guess.");
  expect(encodeSearchText).not.toHaveBeenCalled();
});

it("plays hard with one word a guess and no ranks, and remembers the level", async () => {
  const view = render(<Warmer photos={photos} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Hard" }));
  fireEvent.click(screen.getByRole("button", { name: /^Start Warmer/ }));
  answerWith(targetIndex());
  await guess("red bicycle");
  expect(screen.getByRole("alert")).toHaveTextContent("One word per guess.");
  await guess("far");
  const list = screen.getByRole("list", { name: "Your guesses, closest first" });
  expect(within(list).getByText("Freezing")).toBeInTheDocument();
  expect(within(list).queryByText(`#${SIZE} of ${SIZE}`)).toBeNull();
  view.unmount();

  render(<Warmer photos={photos} />);
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Hard" })).toHaveAttribute("aria-pressed", "true");
});

it("plays the daily on normal whatever the player's level", async () => {
  localStorage.setItem("snapshots-fun-settings-v1:warmer", JSON.stringify({ level: "hard" }));
  window.history.replaceState(null, "", "/fun/warmer?daily");
  render(<Warmer photos={photos} />);
  await act(async () => {});
  answerWith(targetIndex());
  await guess("far away");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText(`#${SIZE} of ${SIZE}`)).toBeInTheDocument();
});
