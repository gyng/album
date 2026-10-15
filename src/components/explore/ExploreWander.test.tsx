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

const load = async (url = "/explore?wander=../albums/walk/start.jpg", source = points) => {
  window.history.replaceState(null, "", url);
  jest.mocked(fetchEmbeddingSpaceOnce).mockResolvedValue({
    points: source,
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

it("offers scene jumps and remembers explored photos after going back", async () => {
  const source = [
    ...points,
    point("mountain", ["mountain", "forest"], [0]),
    point("beach", ["sea", "beach"], [0]),
  ];
  await load(undefined, source);
  fireEvent.click(screen.getByRole("button", { name: "Nature" }));
  expect(here()).toHaveAttribute("href", "/album/walk#mountain.jpg");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(here()).toHaveAttribute("href", "/album/walk#start.jpg");
  expect(screen.queryByRole("button", { name: "Nature" })).toBeNull();
  expect(
    within(screen.getByRole("list", { name: "Ways on" }))
      .getAllByRole("button")
      .every((button) => button.querySelector("img")?.getAttribute("src") !== source[3]!.src),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Water" }));
  expect(here()).toHaveAttribute("href", "/album/walk#beach.jpg");
  expect(new URLSearchParams(window.location.search).get("wander")).toBe(
    "../albums/walk/beach.jpg",
  );
});

it("requires an explicit restart once every photograph has been explored", async () => {
  await load();
  fireEvent.click(screen.getByRole("button", { name: "closest" }));
  fireEvent.click(screen.getByRole("button", { name: "closest" }));
  expect(screen.getByRole("button", { name: "Take a leap" })).toBeDisabled();
  expect(
    within(screen.getByRole("list", { name: "Ways on" })).queryAllByRole("button"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Take a leap" })).toBeEnabled();
  expect(
    within(screen.getByRole("list", { name: "Ways on" })).getAllByRole("button").length,
  ).toBeGreaterThan(0);
});

it("links Give me a quest to the Fun game, carrying the current photograph", async () => {
  await load();
  const link = screen.getByRole("link", { name: "Give me a quest" });
  const url = new URL(link.getAttribute("href")!, "https://example.org");
  expect(url.pathname).toBe("/fun/wander");
  expect(url.searchParams.get("mode")).toBe("quest");
  expect(url.searchParams.get("play")).toBe("1");
  expect(url.searchParams.get("wander")).toBe("../albums/walk/start.jpg");
});

it("steers by more or less of a subject and by a linked keyword", async () => {
  await load();
  fireEvent.click(screen.getByRole("button", { name: "More street" }));
  expect(here()).toHaveAttribute("href", "/album/walk#next.jpg");
  fireEvent.change(screen.getByRole("textbox", { name: "Wander keyword" }), {
    target: { value: "canal" },
  });
  fireEvent.submit(screen.getByRole("textbox", { name: "Wander keyword" }).closest("form")!);
  expect(here()).toHaveAttribute("href", "/album/walk#canal.jpg");
});
it("keeps the walk in place when no photo matches a keyword", async () => {
  await load();
  fireEvent.change(screen.getByRole("textbox", { name: "Wander keyword" }), {
    target: { value: "unicorn" },
  });
  fireEvent.submit(screen.getByRole("textbox", { name: "Wander keyword" }).closest("form")!);
  expect(here()).toHaveAttribute("href", "/album/walk#start.jpg");
  expect(screen.getByRole("status")).toHaveTextContent("No unexplored photographs");
});

it("keeps wider game jumps on cooldown and unlocks an escape at a dead end", async () => {
  const source = [
    point("start", ["city"], [1]),
    point("local", ["city"], [0]),
    point("forest", ["forest"], []),
  ];
  window.history.replaceState(null, "", "/fun/wander");
  jest.mocked(fetchEmbeddingSpaceOnce).mockResolvedValue({
    points: source,
    clusters: [],
    axisScale: { x: 1, y: 1, z: 1 },
    atlas: null,
  });
  render(<ExploreWander initialIndex={0} escapeInterval={3} />);
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Take a leap" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Nature" })).toBeDisabled();
  expect(
    within(screen.getByRole("list", { name: "Ways on" })).queryByRole("button", {
      name: "further afield",
    }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "closest" }));
  expect(screen.getByRole("button", { name: "Take a leap" })).toBeEnabled();
  expect(
    within(screen.getByRole("list", { name: "Ways on" })).getByRole("button", {
      name: "further afield",
    }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("button", { name: "Take a leap" })).toBeEnabled();
});

it("earns jumps from fresh local moves, without farming Back", async () => {
  const source = [
    point("start", ["city"], [1, 2]),
    point("one", ["city"], [0, 2]),
    point("two", ["city"], [3]),
    point("three", ["city"], [2]),
    point("forest", ["forest"], [5]),
    point("lake", ["water"], [4]),
  ];
  window.history.replaceState(null, "", "/fun/wander");
  jest.mocked(fetchEmbeddingSpaceOnce).mockResolvedValue({
    points: source,
    clusters: [],
    axisScale: { x: 1, y: 1, z: 1 },
    atlas: null,
  });
  render(<ExploreWander initialIndex={0} escapeInterval={2} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "closest" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("button", { name: "Take a leap" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "closest" }));
  expect(screen.getByRole("button", { name: "Take a leap" })).toBeEnabled();
  fireEvent.click(
    within(screen.getByRole("list", { name: "Ways on" })).getByRole("button", {
      name: "further afield",
    }),
  );
  expect(screen.getByRole("button", { name: "Take a leap" })).toBeDisabled();
});
