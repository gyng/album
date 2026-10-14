/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Hindsight } from "./Hindsight";
import { dailyNumber, localDayKey } from "../../util/gameDaily";
import { buildHindsightPuzzle } from "../../util/hindsight";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { dailyPhotoOrder, dailyPuzzle } from "./GameRecord";
import { readGameStats } from "./useGameStats";
import { gameSettingsStorageKey } from "./useGameSettings";

// One photograph a year: "Year 2003" was taken in 2003.
const photos: PhotoGamePhoto[] = Array.from({ length: 12 }, (_, i) => ({
  path: `../albums/trip-${i}/${i}.jpg`,
  href: `/album/trip-${i}#${i}.jpg`,
  caption: `Year ${2000 + i}`,
  tags: "",
  vector: [],
  takenAt: `${2000 + i}-06-01T12:00:00`,
}));

const yearOf = (element: HTMLElement) =>
  Number(/Year (\d{4})/.exec(element.textContent + (element.querySelector("img")?.alt ?? ""))![1]);
const tray = () => screen.getAllByRole("button", { name: /^Year \d{4} Photograph \d$/ });
const slots = () =>
  within(screen.getByRole("list", { name: "Your order, oldest first" })).getAllByRole("listitem");
const placeAll = (sort: (a: number, b: number) => number) => {
  for (const choice of [...tray()].sort((a, b) => sort(yearOf(a), yearOf(b))))
    fireEvent.click(choice);
};
const start = async () => {
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /^Start/ }));
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/fun/hindsight");
});

it("places photographs by tap, moves focus along the tray and reveals a perfect order", async () => {
  render(<Hindsight photos={photos} />);
  await start();
  expect(screen.getByRole("status")).toHaveTextContent("0 of 5 placed");
  const [first, second] = tray();
  fireEvent.click(first!);
  expect(first).toBeDisabled();
  expect(second).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Undo last" }));
  expect(first).toHaveFocus();
  placeAll((a, b) => a - b);
  expect(screen.getByRole("button", { name: "Check order" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Check order" }));
  const result = screen.getByRole("region", { name: "Hindsight result" });
  expect(result).toHaveFocus();
  expect(within(result).getByText("In order: 100 / 100")).toBeInTheDocument();
  // Every photograph links to its album, and each shows when it was taken.
  const taken = within(result).getByRole("list", { name: "Order taken" });
  expect(within(taken).getAllByRole("link")).toHaveLength(5);
  expect(within(taken).getAllByText(/1 June \d{4} at 12:00/)).toHaveLength(5);
});

it("reorders with move earlier and later buttons, keeping focus on the moved photograph", async () => {
  render(<Hindsight photos={photos} />);
  await start();
  placeAll((a, b) => b - a);
  const firstYear = yearOf(slots()[0]!);
  const later = screen.getByRole("button", { name: "Move photograph 1 later" });
  later.focus();
  fireEvent.click(later);
  expect(yearOf(slots()[1]!)).toBe(firstYear);
  expect(
    within(slots()[1]!).getByRole("button", { name: "Move photograph 2 later" }),
  ).toHaveFocus();
  // At the newest end, the opposite move takes focus.
  for (let index = 2; index <= 4; index++)
    fireEvent.click(screen.getByRole("button", { name: `Move photograph ${index} later` }));
  expect(
    within(slots()[4]!).getByRole("button", { name: "Move photograph 5 earlier" }),
  ).toHaveFocus();
  expect(yearOf(slots()[4]!)).toBe(firstYear);
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(screen.getByRole("region", { name: "Hindsight result" })).toBeInTheDocument();
  // Reversed, then the newest carried to the end: the three pairs among the
  // middle remain reversed, the four with the newest are right.
  expect(screen.getByText("In order: 40 / 100")).toBeInTheDocument();
});

it("removes a placed photograph back to the tray", async () => {
  render(<Hindsight photos={photos} />);
  await start();
  fireEvent.click(tray()[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Remove photograph 1" }));
  expect(screen.getByRole("status")).toHaveTextContent("0 of 5 placed");
  expect(tray()[0]).toBeEnabled();
  expect(tray()[0]).toHaveFocus();
});

it("records a finished game once and shows the record in the lobby", async () => {
  render(<Hindsight photos={photos} />);
  await start();
  placeAll((a, b) => a - b);
  fireEvent.keyDown(document.body, { key: "Enter" });
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(readGameStats("hindsight")).toMatchObject({ played: 1, won: 1, best: 100 });
  expect(screen.queryByRole("button", { name: "Share result" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Change settings" }));
  expect(screen.getByText(/Played 1 · won 1 · best 100%/)).toBeInTheDocument();
});

it("deals from the chosen size and spread", async () => {
  render(<Hindsight photos={photos} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "6" }));
  fireEvent.click(screen.getByRole("button", { name: /^Start/ }));
  expect(tray()).toHaveLength(6);
  fireEvent.click(screen.getByRole("button", { name: "Change settings" }));
  fireEvent.click(screen.getByRole("button", { name: "One trip" }));
  fireEvent.click(screen.getByRole("button", { name: /^Start/ }));
  // Every album here holds one photograph, so there is no trip to deal.
  expect(screen.getByRole("alert")).toHaveTextContent(/not enough/i);
});

it("plays today's daily from ?daily with fixed settings, shares it and records it once", async () => {
  localStorage.setItem(
    gameSettingsStorageKey("hindsight"),
    JSON.stringify({ size: 4, spread: "years" }),
  );
  window.history.replaceState(null, "", "/fun/hindsight?daily");
  // The archive arrives in random order; the daily must not depend on it.
  render(<Hindsight photos={[...photos].reverse()} />);
  await act(async () => {});
  const expected = buildHindsightPuzzle(
    dailyPhotoOrder(photos),
    { size: 5, spread: "years" },
    dailyPuzzle("hindsight").random(),
  )!;
  expect(tray().map(yearOf)).toEqual(expected.hand.map((photo) => Number(photo.caption.slice(5))));
  expect(screen.getByText(`Daily #${dailyNumber(localDayKey())}`)).toBeInTheDocument();
  placeAll((a, b) => a - b);
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(screen.getByRole("button", { name: "Share result" })).toBeInTheDocument();
  expect(readGameStats("hindsight").dailies[localDayKey()]).toEqual({
    won: true,
    score: 100,
    summary: "5 photographs · 100% in order",
  });
  expect(JSON.parse(localStorage.getItem(gameSettingsStorageKey("hindsight"))!)).toEqual({
    size: 4,
    spread: "years",
  });
  // Play again after a daily is practice with the player's own settings.
  fireEvent.keyDown(document.body, { key: "n" });
  expect(window.location.search).toBe("");
  expect(screen.queryByText(/^Daily #/)).toBeNull();
  expect(tray()).toHaveLength(4);
  // Replaying the finished daily is not recorded a second time.
  fireEvent.click(screen.getByRole("button", { name: "Change settings" }));
  expect(screen.getByText(/Played today/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: `Daily #${dailyNumber(localDayKey())}` }));
  expect(window.location.search).toBe("?daily=");
  placeAll((a, b) => b - a);
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(readGameStats("hindsight")).toMatchObject({ played: 1 });
  expect(readGameStats("hindsight").dailies[localDayKey()]).toMatchObject({ score: 100 });
});

it("explains when there are not enough dated photographs", () => {
  render(<Hindsight photos={photos.slice(0, 3)} />);
  expect(screen.getByText(/not enough dated photographs/i)).toBeInTheDocument();
});

it("places by drag and drop into the next free slot and between slots", async () => {
  render(<Hindsight photos={photos} />);
  await start();
  const values = new Map<string, string>();
  const transfer = {
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
  const [first, second] = tray();
  fireEvent.dragStart(first!, { dataTransfer: transfer });
  fireEvent.dragOver(slots()[3]!, { dataTransfer: transfer });
  expect(slots()[0]).toHaveAttribute("data-drop-hover", "true");
  fireEvent.drop(slots()[3]!, { dataTransfer: transfer });
  fireEvent.dragStart(second!, { dataTransfer: transfer });
  fireEvent.drop(slots()[0]!, { dataTransfer: transfer });
  expect(screen.getByRole("status")).toHaveTextContent("2 of 5 placed");
  expect(yearOf(slots()[0]!)).toBe(yearOf(second!));
  expect(yearOf(slots()[1]!)).toBe(yearOf(first!));
});
