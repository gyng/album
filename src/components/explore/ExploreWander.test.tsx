/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ExploreWander } from "./ExploreWander";
import { fetchEmbeddingSpaceOnce, type EmbeddingSpaceEntry } from "../../util/embeddingSpaceData";

jest.mock("../../util/embeddingSpaceData", () => ({
  ...jest.requireActual("../../util/embeddingSpaceData"),
  fetchEmbeddingSpaceOnce: jest.fn(),
}));

const point = (
  name: string,
  tags: string[],
  near: number[],
  around: number[] = [],
): EmbeddingSpaceEntry => ({
  src: `/data/albums/walk/.resized_images/${name}.jpg%40800.avif`,
  href: `/album/walk#${name}.jpg`,
  label: `${name}.jpg`,
  tags,
  swatch: "rgb(128, 128, 128)",
  near,
  around,
  x: 0,
  y: 0,
  z: 0,
});

const points = [
  point("start", ["street"], [1, 2]),
  point("next", ["street"], [0, 2]),
  point("canal", ["street", "canal"], [0, 1]),
];

const load = async (url = "/explore?wander=../albums/walk/start.jpg") => {
  window.history.replaceState(null, "", url);
  jest.mocked(fetchEmbeddingSpaceOnce).mockResolvedValue({
    points,
    clusters: [],
    axisScale: { x: 1, y: 1, z: 1 },
    atlas: null,
  });
  const onTrailChange = jest.fn();
  render(<ExploreWander onTrailChange={onTrailChange} />);
  await act(async () => {});
  return onTrailChange;
};

const here = () => screen.getAllByRole("link")[0]!;

it("starts where the link says, steps through labelled exits and shares where it stands", async () => {
  const onTrailChange = await load();
  expect(here()).toHaveAttribute("href", "/album/walk#start.jpg");
  const exits = within(screen.getByRole("list", { name: "Ways on" }));
  expect(exits.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "closest",
    "canal",
  ]);
  fireEvent.click(exits.getByRole("button", { name: "canal" }));
  expect(here()).toHaveAttribute("href", "/album/walk#canal.jpg");
  expect(new URLSearchParams(window.location.search).get("wander")).toBe(
    "../albums/walk/canal.jpg",
  );
  expect(onTrailChange).toHaveBeenLastCalledWith([points[0]!.src, points[2]!.src]);

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(here()).toHaveAttribute("href", "/album/walk#start.jpg");
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
});

it("returns to any earlier step from the trail", async () => {
  await load();
  fireEvent.click(screen.getByRole("button", { name: "closest" }));
  fireEvent.click(screen.getByRole("button", { name: "closest" }));
  const trail = within(screen.getByRole("list", { name: "Your walk" }));
  expect(trail.getAllByRole("button")).toHaveLength(3);
  fireEvent.click(trail.getByRole("button", { name: "Step 1: start.jpg" }));
  expect(here()).toHaveAttribute("href", "/album/walk#start.jpg");
});

it("does not write the URL for a random start", async () => {
  await load("/explore");
  expect(window.location.search).toBe("");
});
