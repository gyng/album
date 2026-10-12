/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PhotoConnections } from "./PhotoConnections";
import type { PhotoGamePhoto } from "../../util/photoGames";
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
