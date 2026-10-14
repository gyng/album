/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { CaptionIt } from "./CaptionIt";
import { encodeSearchText } from "../search/textEmbeddings";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { readGameStats } from "./useGameStats";

jest.mock("../search/textEmbeddings", () => ({ encodeSearchText: jest.fn() }));

const SIZE = 20;
const oneHot = (index: number): number[] =>
  Array.from({ length: SIZE }, (_, i) => (i === index ? 1 : 0));
const photos: PhotoGamePhoto[] = Array.from({ length: SIZE }, (_, i) => ({
  path: `../albums/test-simple/photo-${i}.jpg`,
  href: `/album/test-simple#photo-${i}.jpg`,
  caption: `Archive photograph number ${i} of the test set.`,
  tags: "",
  vector: oneHot(i),
}));

const shown = () => Number(/photo-(\d+)/.exec(screen.getByRole("img").getAttribute("src")!)![1]);
const write = (text: string) =>
  fireEvent.change(screen.getByLabelText("Your caption"), { target: { value: text } });
const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Score caption" }));
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/fun/caption-it");
});

it("scores a caption by how well it picks the photograph out of the archive, against the archive's own", async () => {
  render(<CaptionIt photos={photos} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /^Start Caption It/ }));
  const target = shown();
  // The player's caption points straight at it; the archive's own points elsewhere.
  jest.mocked(encodeSearchText).mockImplementation(async (text) => {
    if (text === photos[target]!.caption) {
      const away = oneHot((target + 1) % SIZE);
      away[target] = 0.5;
      return away;
    }
    return oneHot(target);
  });
  write("A very particular test photograph");
  await submit();
  const result = screen.getByRole("region", { name: "Caption It result" });
  expect(result).toHaveFocus();
  expect(within(result).getByText("Fit: 100 / 100")).toBeInTheDocument();
  expect(within(result).getByText("Perfect")).toBeInTheDocument();
  expect(result).toHaveTextContent(
    "Your caption ranked this photograph first of all. The archive’s own caption ranked it 2 of 20 — yours did better.",
  );
  expect(readGameStats("caption-it")).toMatchObject({ played: 1, won: 1, best: 100 });

  // Rewriting keeps the caption and does not count as another game.
  fireEvent.click(within(result).getByRole("button", { name: "Rewrite this caption" }));
  expect(screen.getByLabelText("Your caption")).toHaveValue("A very particular test photograph");
  await submit();
  expect(readGameStats("caption-it")).toMatchObject({ played: 1 });
});

it("refuses a caption stuffed with one word before loading the model", async () => {
  render(<CaptionIt photos={photos} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /^Start Caption It/ }));
  write("boat boat boat boat");
  await submit();
  expect(screen.getByRole("alert")).toHaveTextContent("Use each word once or twice.");
  expect(encodeSearchText).not.toHaveBeenCalled();
});

it("reports a model that fails to load and lets the player retry", async () => {
  render(<CaptionIt photos={photos} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /^Start Caption It/ }));
  jest.mocked(encodeSearchText).mockRejectedValueOnce(new Error("offline"));
  write("A boat on a river");
  await submit();
  expect(screen.getByRole("alert")).toHaveTextContent("could not be compared");
  expect(screen.getByRole("button", { name: "Score caption" })).toBeEnabled();
  expect(readGameStats("caption-it").played).toBe(0);
});
