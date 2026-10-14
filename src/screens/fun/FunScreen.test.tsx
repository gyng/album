/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import FunScreen from "./FunScreen";
import { gameStatsStorageKey } from "../../components/fun/useGameStats";
import { EMPTY_GAME_STATS, recordGameResult } from "../../util/gameStats";
import { localDayKey } from "../../util/gameDaily";

jest.mock("../../components/GlobalNav", () => ({ GlobalNav: () => null }));
jest.mock("../../components/Seo", () => ({ Seo: () => null }));

const playedOn = (game: "relay" | "guess", day: string) =>
  localStorage.setItem(
    gameStatsStorageKey(game),
    JSON.stringify(recordGameResult(EMPTY_GAME_STATS, { won: true }, day)),
  );

beforeEach(() => localStorage.clear());

it("marks the games finished today, in words", () => {
  playedOn("relay", localDayKey());
  playedOn("guess", "2020-01-01");
  render(<FunScreen />);
  expect(screen.getByRole("link", { name: /Photo Relay/ })).toHaveTextContent("Played today");
  expect(screen.getByRole("link", { name: /Guess Where/ })).not.toHaveTextContent("Played today");
  expect(screen.getAllByText("Played today")).toHaveLength(1);
});

it("lists every game, including Hindsight", () => {
  render(<FunScreen />);
  expect(screen.getByRole("link", { name: /Hindsight/ })).toHaveAttribute("href", "/fun/hindsight");
});

it("renders no mark on the server, so hydration matches", () => {
  playedOn("relay", localDayKey());
  expect(renderToString(<FunScreen />)).not.toContain("Played today");
});
