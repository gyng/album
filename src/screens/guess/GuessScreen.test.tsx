/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import GuessScreen from "./GuessScreen";
import type { GameSettings } from "../../components/guess/guessTypes";

const mockReplaceSearchParams = jest.fn();
let mockSearch = "";

jest.mock("../../components/platform", () => ({
  __esModule: true,
  AppLink: ({ children, href }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
  useUrlSearchParams: () => {
    const searchParams = new URLSearchParams(mockSearch);
    return {
      ready: true,
      searchParams,
      getSearchParam: (name: string) => searchParams.get(name),
      hasSearchParam: (name: string) => searchParams.has(name),
      replaceSearchParams: mockReplaceSearchParams,
    };
  },
}));

jest.mock("../../components/database/useDatabase", () => ({
  useDatabase: () => [{}, 100, null, null, jest.fn()],
}));

jest.mock("../../components/fun/useGameSettings", () => ({
  useGameSettings: () => [{ rounds: 5, timeLimit: null, region: "" }, jest.fn(), true],
}));

jest.mock("../../components/GlobalNav", () => ({ GlobalNav: () => null }));
jest.mock("../../components/Seo", () => ({ Seo: () => null }));

jest.mock("../../components/guess/GuessGame", () => ({
  GuessGame: ({
    onSeedGenerated,
  }: {
    onSeedGenerated: (seed: string, settings: GameSettings) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() => onSeedGenerated("abc123", { rounds: 3, timeLimit: 15, region: "Japan" })}
      >
        Deal
      </button>
      <button
        type="button"
        onClick={() => onSeedGenerated("daily", { rounds: 5, timeLimit: null, daily: true })}
      >
        Deal daily
      </button>
    </>
  ),
}));

describe("GuessScreen", () => {
  beforeEach(() => {
    mockReplaceSearchParams.mockClear();
    mockSearch = "?utm=keep&daily";
  });

  it("writes the dealt game into the URL through the platform port", () => {
    const replaceState = jest.spyOn(window.history, "replaceState");
    render(<GuessScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Deal" }));

    expect(replaceState).not.toHaveBeenCalled();
    const params: URLSearchParams = mockReplaceSearchParams.mock.calls[0][0];
    expect(Object.fromEntries(params)).toEqual({
      utm: "keep",
      seed: "abc123",
      rounds: "3",
      timer: "15",
      region: "Japan",
    });

    fireEvent.click(screen.getByRole("button", { name: "Deal daily" }));
    const daily: URLSearchParams = mockReplaceSearchParams.mock.calls[1][0];
    expect(Object.fromEntries(daily)).toEqual({ utm: "keep", daily: "" });
    replaceState.mockRestore();
  });
});
