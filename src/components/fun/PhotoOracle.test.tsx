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

it("discovers a photograph through answers without asking the player to remember one", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Find me a photograph" }));
  expect(screen.queryByRole("button", { name: /Remember photograph/ })).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  for (let i = 0; i < 8 && screen.queryByRole("button", { name: "Yes" }); i++)
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep this one" }));
  expect(screen.getByRole("region", { name: "Oracle result" }).querySelector("img")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.queryByRole("button", { name: /Remember photograph/ })).toBeNull();
});

it("keeps asking useful tag questions after eight answers", () => {
  const tagged = Array.from({ length: 20 }, (_, i) => ({
    ...photos[0]!,
    path: `../albums/test-simple/tagged-${i}.jpg`,
    caption: "A photograph",
    tags: `subject_${String.fromCharCode(97 + Math.floor(i / 2))}`,
  }));
  render(<PhotoOracle photos={tagged} />);
  fireEvent.click(screen.getByRole("button", { name: "Find me a photograph" }));
  for (let i = 0; i < 8; i++) fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
  expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
  expect(screen.getByRole("status")).toHaveTextContent("subject");
  expect(screen.queryByRole("button", { name: "Keep this one" })).toBeNull();
});

it("acknowledges indistinguishable matches and lets the player browse them", () => {
  render(
    <PhotoOracle
      photos={[photos[0]!, { ...photos[0]!, path: "../albums/test-simple/twin.jpg" }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find me a photograph" }));
  expect(screen.getByRole("status")).toHaveTextContent("2 matches");
  const first = screen.getByRole("img").getAttribute("src");
  fireEvent.click(screen.getByRole("button", { name: "Another match" }));
  expect(screen.getByRole("img").getAttribute("src")).not.toBe(first);
  expect(screen.getByRole("button", { name: "Another match" })).toBeDisabled();
});

it("narrows discovery to a single matching photograph and restores the pool on Back", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Find me a photograph" }));
  const question = screen.getByRole("status").textContent;
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(screen.getByRole("img")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
  expect(screen.getByRole("button", { name: "Another match" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("status")).toHaveTextContent(question!);
  expect(screen.queryByRole("img")).toBeNull();
});
