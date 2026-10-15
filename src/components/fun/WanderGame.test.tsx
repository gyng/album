/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { WanderGame } from "./WanderGame";
import { fetchEmbeddingSpaceOnce, type EmbeddingSpaceEntry } from "../../util/embeddingSpaceData";
import { readGameStats } from "./useGameStats";
jest.mock("../../util/embeddingSpaceData", () => ({
  ...jest.requireActual("../../util/embeddingSpaceData"),
  fetchEmbeddingSpaceOnce: jest.fn(),
}));
const point = (name: string, tags: string[], near = [1, 2, 3]): EmbeddingSpaceEntry => ({
  src: `/data/albums/walk/.resized_images/${name}.jpg%40800.avif`,
  href: `/album/walk#${name}.jpg`,
  label: name,
  tags,
  near,
  around: [],
  x: 0,
  y: 0,
  z: 0,
});
const points = [
  point("start", []),
  point("cat-stairs", ["cat", "stairs"], [2, 3]),
  point("forest-waterfall", ["forest", "waterfall"], [3]),
  point("lake-mountain", ["lake", "mountain"], [0]),
  ...["cat", "stairs", "forest", "waterfall", "lake", "mountain"].flatMap((tag) =>
    Array.from({ length: 8 }, (_, i) => point(`${tag}-${i}`, [tag], [0])),
  ),
];
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/fun/wander");
  jest.spyOn(Math, "random").mockReturnValue(0);
  jest
    .mocked(fetchEmbeddingSpaceOnce)
    .mockResolvedValue({ points, clusters: [], axisScale: { x: 1, y: 1, z: 1 }, atlas: null });
});
afterEach(() => jest.restoreAllMocks());
const load = async (linkedMode?: "quest" | "roam" | "hunt") => {
  render(
    <StrictMode>
      <WanderGame {...(linkedMode ? { linkedMode } : {})} />
    </StrictMode>,
  );
  await act(async () => {});
};
const step = () =>
  fireEvent.click(
    within(screen.getByRole("list", { name: "Ways on" })).getByRole("button", { name: "closest" }),
  );
it("completes a quest on finding both subjects, records it once and can play again", async () => {
  await load();
  fireEvent.click(screen.getByRole("button", { name: "Start quest" }));
  await act(async () => {});
  expect(screen.getByRole("list", { name: "Quest targets" })).toHaveTextContent("cat + stairs");
  step();
  expect(screen.getByRole("region", { name: "Wander result" })).toHaveTextContent("Quest complete");
  expect(screen.getByRole("region", { name: "Wander result" })).toHaveTextContent("1 step");
  expect(readGameStats("wander")).toMatchObject({ played: 1, won: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  await act(async () => {});
  expect(screen.queryByRole("region", { name: "Wander result" })).toBeNull();
  expect(readGameStats("wander").played).toBe(1);
});
it("offers aimless free roaming and finishes the walk only when asked", async () => {
  await load();
  fireEvent.click(screen.getByRole("radio", { name: "Free roam" }));
  fireEvent.click(screen.getByRole("button", { name: "Start wandering" }));
  await act(async () => {});
  expect(screen.queryByRole("list", { name: "Quest targets" })).toBeNull();
  step();
  expect(screen.queryByRole("region", { name: "Wander result" })).toBeNull();
  expect(readGameStats("wander").played).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "End walk" }));
  expect(screen.getByRole("region", { name: "Wander result" })).toHaveTextContent("Your wander");
  expect(readGameStats("wander").played).toBe(1);
});
it("collects three separate finds before ending a scavenger hunt", async () => {
  await load();
  fireEvent.click(screen.getByRole("radio", { name: "Scavenger hunt" }));
  fireEvent.click(screen.getByRole("button", { name: "Start hunt" }));
  await act(async () => {});
  expect(
    within(screen.getByRole("list", { name: "Quest targets" })).getAllByRole("listitem"),
  ).toHaveLength(3);
  step();
  expect(screen.queryByRole("region", { name: "Wander result" })).toBeNull();
  expect(screen.getByRole("list", { name: "Quest targets" })).toHaveTextContent(
    "Found cat + stairs",
  );
  step();
  step();
  expect(screen.getByRole("region", { name: "Wander result" })).toHaveTextContent("3 of 3 found");
  expect(readGameStats("wander")).toMatchObject({ played: 1, won: 1 });
});
it("opens an Explore quest at the linked photograph and does not replace a saved free-roam preference", async () => {
  localStorage.setItem("snapshots-fun-settings-v1:wander", JSON.stringify({ mode: "roam" }));
  window.history.replaceState(
    null,
    "",
    "/fun/wander?play=1&mode=quest&wander=../albums/walk/start.jpg",
  );
  await load("quest");
  expect(screen.getByRole("img", { name: "start" })).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Quest targets" })).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("snapshots-fun-settings-v1:wander")!)).toMatchObject({
    mode: "roam",
  });
});
it("reveals a valid target when giving up", async () => {
  await load();
  fireEvent.click(screen.getByRole("button", { name: "Start quest" }));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(
    within(screen.getByRole("region", { name: "Wander result" })).getByRole("img", {
      name: "cat-stairs",
    }),
  ).toBeInTheDocument();
  expect(readGameStats("wander")).toMatchObject({ played: 1, won: 0 });
});
it("provides exact target photographs and collects each once", async () => {
  window.history.replaceState(null, "", "/fun/wander?wander=../albums/walk/start.jpg");
  await load();
  fireEvent.click(screen.getByRole("radio", { name: "Photo hunt" }));
  fireEvent.click(screen.getByRole("button", { name: "Start hunt" }));
  await act(async () => {});
  const targets = screen.getByRole("list", { name: "Quest targets" });
  expect(within(targets).getAllByRole("img")).toHaveLength(3);
  step();
  expect(within(targets).getAllByLabelText("Completed")).toHaveLength(1);
  step();
  step();
  expect(screen.getByRole("region", { name: "Wander result" })).toHaveTextContent("3 of 3 found");
});
it("uses difficulty to change the photo hunt size and remembers the choice", async () => {
  await load();
  fireEvent.click(screen.getByRole("radio", { name: "Photo hunt" }));
  fireEvent.click(screen.getByRole("radio", { name: "Hard" }));
  fireEvent.click(screen.getByRole("button", { name: "Start hunt" }));
  await act(async () => {});
  expect(
    within(screen.getByRole("list", { name: "Quest targets" })).getAllByRole("img"),
  ).toHaveLength(5);
  expect(JSON.parse(localStorage.getItem("snapshots-fun-settings-v1:wander")!)).toMatchObject({
    difficulty: "hard",
  });
});
