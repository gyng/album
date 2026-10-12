/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { PhotoOracle } from "./PhotoOracle";
import type { PhotoGamePhoto } from "../../util/photoGames";

const photos: PhotoGamePhoto[] = [
  "A boat on a river",
  "A person on a city street",
  "A cat in a room",
].map((caption, i) => ({
  path: `../albums/test-simple/${i}.jpg`,
  href: `/album/test-simple#${i}.jpg`,
  caption,
  tags: "",
  vector: [],
}));

it("lets the player remember a photo, answer uncertainty and reveal it on giving up", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Meet the oracle" }));
  fireEvent.click(screen.getByRole("button", { name: "Remember photograph 1" }));
  const remembered = screen.getByRole("img").getAttribute("src");
  fireEvent.click(screen.getByRole("button", { name: "I have my photograph" }));
  expect(screen.queryByRole("img")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(screen.getByRole("region", { name: "Oracle result" })).toBeTruthy();
  expect(screen.getByRole("img")).toHaveAttribute("src", remembered);
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.getAllByRole("button", { name: /Remember photograph/ })).toHaveLength(3);
});

it("continues after an incorrect guess without showing the rejected candidate again", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Meet the oracle" }));
  fireEvent.click(screen.getByRole("button", { name: "Remember photograph 1" }));
  fireEvent.click(screen.getByRole("button", { name: "I have my photograph" }));
  for (let i = 0; i < 16 && screen.queryByRole("button", { name: "Yes" }); i++)
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  const guess = screen.getByRole("img").getAttribute("src");
  fireEvent.click(screen.getByRole("button", { name: "Not this one" }));
  for (let i = 0; i < 16 && screen.queryByRole("button", { name: "Yes" }); i++)
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(screen.getByRole("img").getAttribute("src")).not.toBe(guess);
  fireEvent.click(screen.getByRole("button", { name: "That's it" }));
  expect(screen.getByRole("region", { name: "Oracle result" })).toBeTruthy();
});

it("lets the player undo an uncertain answer and answer the same question again", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Meet the oracle" }));
  fireEvent.click(screen.getByRole("button", { name: "Remember photograph 1" }));
  fireEvent.click(screen.getByRole("button", { name: "I have my photograph" }));
  const question = screen.getByRole("status").textContent;
  fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("status")).toHaveTextContent(question!);
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
});
