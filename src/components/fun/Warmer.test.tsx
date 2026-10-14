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

const hidden = () => screen.getByRole("img", { name: "The hidden photograph, blurred" });
const targetIndex = () => Number(/photo-(\d+)/.exec(hidden().getAttribute("src")!)![1]);
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

it("ranks each guess against the archive, sharpens nothing for a cold one and reveals the photograph when found", async () => {
  render(<Warmer photos={photos} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /^Start Warmer/ }));
  answerWith(targetIndex());

  await guess("far away");
  const list = screen.getByRole("list", { name: "Your guesses, closest first" });
  expect(within(list).getByText("far away")).toBeInTheDocument();
  expect(within(list).getByText("Freezing")).toBeInTheDocument();
  expect(within(list).getByText(`#${SIZE} of ${SIZE}`)).toBeInTheDocument();
  expect(hidden().style.filter).toBe("blur(28px)");

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
  expect(hidden().getAttribute("src")).toContain(expected.path.split("/").at(-1)!);
  answerWith(targetIndex());
  await guess("exact");
  expect(readGameStats("warmer").dailies[localDayKey()]).toMatchObject({
    won: true,
    summary: "Found in 1 guess",
  });
});
