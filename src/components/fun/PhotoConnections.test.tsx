/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PhotoConnections } from "./PhotoConnections";
import type { PhotoGamePhoto } from "../../util/photoGames";
beforeEach(() => localStorage.clear());

const photos: PhotoGamePhoto[] = ["A cat", "A lake", "A red flower", "A train"].flatMap(
  (caption, group) =>
    Array.from({ length: 5 }, (_, i) => ({
      path: `${group}-${i}.jpg`,
      href: `/album/test-simple#${group}-${i}`,
      caption,
      tags: "",
      vector: [],
    })),
);
const choose = (name: string, count: number) =>
  screen
    .getAllByRole("img", { name })
    .slice(0, count)
    .forEach((image) => fireEvent.click(image.closest("button")!));
it("checks groups, avoids charging twice for the same mistake and reveals all connections", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  choose("A cat", 2);
  choose("A lake", 2);
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(screen.getByText("1 mistake · Unlimited lives")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(screen.getByText("1 mistake · Unlimited lives")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Deselect" }));
  choose("A cat", 4);
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(screen.getByRole("status")).toHaveTextContent(/connection found/);
  expect(
    within(screen.getByRole("group", { name: "Photographs" })).getAllByRole("button"),
  ).toHaveLength(12);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(
    within(screen.getByRole("region", { name: "Connections result" })).getAllByRole("img"),
  ).toHaveLength(16);
});
it("ends after four different mistakes and reveals the groups", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "4 lives" }));
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  const cats = screen.getAllByRole("img", { name: "A cat" });
  const boats = screen.getAllByRole("img", { name: "A lake" });
  for (let i = 0; i < 4; i++) {
    [cats[i]!, cats[(i + 1) % 4]!, boats[i]!, boats[(i + 1) % 4]!].forEach((image) =>
      fireEvent.click(image.closest("button")!),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    if (i < 3) fireEvent.click(screen.getByRole("button", { name: "Deselect" }));
  }
  expect(screen.getByRole("region", { name: "Connections result" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Check connection" })).toBeNull();
});

it("lets players choose a six-by-six board and reveals all six groups", () => {
  const archive = ["A cat", "A lake", "A train", "A person", "A mountain", "A staircase"].flatMap(
    (caption, group) =>
      Array.from({ length: 6 }, (_, i) => ({
        path: `${group}-${i}.jpg`,
        href: "/album/test-simple",
        caption,
        tags: "",
        vector: [],
      })),
  );
  render(<PhotoConnections photos={archive} />);
  fireEvent.click(screen.getByRole("button", { name: "6×6" }));
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  expect(
    within(screen.getByRole("group", { name: "Photographs" })).getAllByRole("button"),
  ).toHaveLength(36);
  choose("A cat", 6);
  expect(screen.getByRole("button", { name: "Check connection" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(
    within(screen.getByRole("group", { name: "Photographs" })).getAllByRole("button"),
  ).toHaveLength(30);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(
    within(screen.getByRole("region", { name: "Connections result" })).getAllByRole("img"),
  ).toHaveLength(36);
});

it("restores lobby preferences after remount without restoring an active round", () => {
  const first = render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "6×6" }));
  fireEvent.click(screen.getByRole("button", { name: "Specific subjects" }));
  fireEvent.click(screen.getByRole("button", { name: "8 lives" }));
  fireEvent.click(screen.getByRole("button", { name: "One-away hints on" }));
  first.unmount();
  render(<PhotoConnections photos={photos} />);
  expect(screen.getByRole("button", { name: "6×6" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Specific subjects" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "One-away hints off" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "8 lives" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Start connecting" })).toBeTruthy();
});

it("keeps active selection controls together and removes the dock from the results", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  const controls = screen.getByRole("group", { name: "Connection controls" });
  expect(within(controls).getByRole("button", { name: "Check connection" })).toBeDisabled();
  choose("A cat", 4);
  expect(within(controls).getByRole("button", { name: "Check connection" })).toBeEnabled();
  fireEvent.click(within(controls).getByRole("button", { name: "Deselect" }));
  expect(
    within(screen.getByRole("group", { name: "Photographs" }))
      .getAllByRole("button")
      .every((button) => button.getAttribute("aria-pressed") === "false"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(screen.queryByRole("group", { name: "Connection controls" })).toBeNull();
  expect(screen.getByRole("region", { name: "Connections result" })).toHaveFocus();
});

const makeMistakes = (count: number) => {
  const cats = screen.getAllByRole("img", { name: "A cat" });
  const lakes = screen.getAllByRole("img", { name: "A lake" });
  const pairs = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ];
  for (let index = 0; index < count; index++) {
    const pair = pairs[index % pairs.length]!;
    const lake = Math.floor(index / pairs.length);
    [cats[pair[0]!]!, cats[pair[1]!]!, lakes[lake]!, lakes[lake + 1]!].forEach((image) =>
      fireEvent.click(image.closest("button")!),
    );
    fireEvent.keyDown(document.body, { key: "Enter" });
    if (index + 1 < count) fireEvent.keyDown(document.body, { key: "Escape" });
  }
};

it("keeps unlimited rounds playable beyond eight distinct mistakes", () => {
  render(<PhotoConnections photos={photos} />);
  expect(screen.getByRole("button", { name: "Unlimited" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(document.body, { key: "n" });
  makeMistakes(8);
  expect(screen.getByText("8 mistakes · Unlimited lives")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Connections result" })).toBeNull();
  expect(screen.getByRole("button", { name: "Check connection" })).toBeEnabled();
});

it.each([6, 8])("ends at the selected %i-life budget", (lives) => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: `${lives} lives` }));
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  makeMistakes(lives - 1);
  expect(screen.queryByRole("region", { name: "Connections result" })).toBeNull();
  fireEvent.keyDown(document.body, { key: "Escape" });
  const cats = screen.getAllByRole("img", { name: "A cat" });
  const lakes = screen.getAllByRole("img", { name: "A lake" });
  // One fresh mixed group, distinct from the mistakes above.
  [cats[0]!, lakes[0]!, lakes[1]!, lakes[2]!].forEach((image) =>
    fireEvent.click(image.closest("button")!),
  );
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(screen.getByRole("region", { name: "Connections result" })).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Check connection" })).toBeNull();
});

it("names tiles by their photographs and keeps focus on the board", () => {
  render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
  const board = screen.getByRole("group", { name: "Photographs" });
  expect(board).toHaveFocus();
  expect(within(board).getAllByRole("button", { name: "A cat" })).toHaveLength(4);
  choose("A cat", 4);
  const check = screen.getByRole("button", { name: "Check connection" });
  check.focus();
  fireEvent.click(check);
  expect(screen.getByRole("region", { name: "Animals" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.getByRole("group", { name: "Photographs" })).toHaveFocus();
});

it("keeps focused tiles clear of the sticky dock on small screens", () => {
  const match = jest.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: query.includes("max-width"),
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }) as unknown as MediaQueryList,
  );
  const rect = jest
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockReturnValue({ height: 60 } as DOMRect);
  try {
    const { container } = render(<PhotoConnections photos={photos} />);
    fireEvent.click(screen.getByRole("button", { name: "Start connecting" }));
    expect(
      (container.firstElementChild as HTMLElement).style.getPropertyValue(
        "--connections-dock-height",
      ),
    ).toBe("60px");
  } finally {
    match.mockRestore();
    rect.mockRestore();
  }
});
