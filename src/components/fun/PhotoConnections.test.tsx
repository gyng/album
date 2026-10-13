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
  expect(screen.getByText("3 mistakes remaining")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(screen.getByText("3 mistakes remaining")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Deselect" }));
  choose("A cat", 4);
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(screen.getByRole("status")).toHaveTextContent(/connection found/);
  expect(screen.getAllByRole("button", { name: /Select photograph/ })).toHaveLength(12);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(
    within(screen.getByRole("region", { name: "Connections result" })).getAllByRole("img"),
  ).toHaveLength(16);
});
it("ends after four different mistakes and reveals the groups", () => {
  render(<PhotoConnections photos={photos} />);
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
  expect(screen.getAllByRole("button", { name: /Select photograph/ })).toHaveLength(36);
  choose("A cat", 6);
  expect(screen.getByRole("button", { name: "Check connection" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(screen.getAllByRole("button", { name: /Select photograph/ })).toHaveLength(30);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(
    within(screen.getByRole("region", { name: "Connections result" })).getAllByRole("img"),
  ).toHaveLength(36);
});

it("restores lobby preferences after remount without restoring an active round", () => {
  const first = render(<PhotoConnections photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "6×6" }));
  fireEvent.click(screen.getByRole("button", { name: "Specific subjects" }));
  fireEvent.click(screen.getByRole("button", { name: "One-away hints on" }));
  first.unmount();
  render(<PhotoConnections photos={photos} />);
  expect(screen.getByRole("button", { name: "6×6" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Specific subjects" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "One-away hints off" })).toBeTruthy();
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
    screen
      .getAllByRole("button", { name: /Select photograph/ })
      .every((button) => button.getAttribute("aria-pressed") === "false"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(screen.queryByRole("group", { name: "Connection controls" })).toBeNull();
  expect(screen.getByRole("region", { name: "Connections result" })).toHaveFocus();
});
