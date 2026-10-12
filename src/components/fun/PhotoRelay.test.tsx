/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PhotoRelay } from "./PhotoRelay";
import type { PhotoGamePhoto } from "../../util/photoGames";

const photos: PhotoGamePhoto[] = Array.from({ length: 12 }, (_, i) => ({
  path: `../albums/test-simple/${i}.jpg`,
  href: `/album/test-simple#${i}.jpg`,
  caption: `Photograph ${i}`,
  tags: "",
  vector: [Math.cos(i / 12), Math.sin(i / 12)],
}));

it("reveals the entire suggested chain on giving up and resets for another round", () => {
  render(<PhotoRelay photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start relay" }));
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  const result = screen.getByRole("region", { name: "Relay result" });
  expect(within(result).getAllByRole("link")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.queryByRole("region", { name: "Relay result" })).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("0 of 5");
});

it("supports undo, prevents duplicate links and shows a scored chain after all five choices", () => {
  render(<PhotoRelay photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start relay" }));
  const first = screen.getByRole("button", { name: "Choose photograph 1" });
  fireEvent.click(first);
  expect(first).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Undo last link" }));
  expect(first).toBeEnabled();
  for (let i = 1; i <= 5; i++)
    fireEvent.click(screen.getByRole("button", { name: `Choose photograph ${i}` }));
  const result = screen.getByRole("region", { name: "Relay result" });
  expect(within(result).getByText(/Visual flow: \d+ \/ 100/)).toBeTruthy();
  expect(within(result).getAllByRole("list")[0]?.children).toHaveLength(7);
});
