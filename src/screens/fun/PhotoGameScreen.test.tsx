/** @jest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { PhotoGameScreen } from "./PhotoGameScreen";
import { GameIntro } from "../../components/fun/GameIllustration";
import { fetchPhotoGameArchive } from "../../components/search/api";

jest.mock("../../components/database/useDatabase", () => {
  const database = {};
  return {
    useDatabase: () => [database, 100, {}, null, jest.fn()],
    useEmbeddingsDatabase: () => [null, 100, {}, null, jest.fn()],
  };
});
jest.mock("../../components/search/api", () => ({ fetchPhotoGameArchive: jest.fn() }));
jest.mock("../../components/GlobalNav", () => ({ GlobalNav: () => null }));
jest.mock("../../components/Seo", () => ({ Seo: () => null }));
jest.mock("../../components/fun/PhotoConnections", () => ({
  PhotoConnections: () => (
    <GameIntro game="connections">
      <button type="button">Start connecting</button>
    </GameIntro>
  ),
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

it("does not flash loading text when photographs are already available", async () => {
  jest
    .mocked(fetchPhotoGameArchive)
    .mockResolvedValue([{ path: "a", href: "a", caption: "A photo", tags: "", vector: [] }]);
  render(<PhotoGameScreen game="connections" />);
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Start connecting" })).toBeTruthy();
  act(() => jest.advanceTimersByTime(300));
  expect(screen.queryByRole("status")).toBeNull();
});

it("shows progress for a real wait and clears it when photographs arrive", async () => {
  let resolve!: (photos: Awaited<ReturnType<typeof fetchPhotoGameArchive>>) => void;
  jest.mocked(fetchPhotoGameArchive).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<PhotoGameScreen game="connections" />);
  act(() => jest.advanceTimersByTime(180));
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  await act(async () =>
    resolve([{ path: "a", href: "a", caption: "A photo", tags: "", vector: [] }]),
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("button", { name: "Start connecting" })).toBeTruthy();
});

it("shows recoverable errors immediately rather than waiting for the loading delay", async () => {
  jest.mocked(fetchPhotoGameArchive).mockRejectedValue(new Error("Unavailable"));
  render(<PhotoGameScreen game="connections" />);
  await act(async () => {});
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});

it("keeps the real lobby mounted and disabled while data loads, then enables the same start control", async () => {
  let resolve!: (photos: Awaited<ReturnType<typeof fetchPhotoGameArchive>>) => void;
  jest.mocked(fetchPhotoGameArchive).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<PhotoGameScreen game="connections" />);
  const start = screen.getByRole("button", { name: "Start connecting" });
  expect(start).toBeDisabled();
  await act(async () =>
    resolve([{ path: "a", href: "a", caption: "A photo", tags: "", vector: [] }]),
  );
  expect(screen.getByRole("button", { name: "Start connecting" })).toBe(start);
  expect(start).toBeEnabled();
});
