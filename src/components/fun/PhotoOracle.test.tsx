/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PhotoOracle } from "./PhotoOracle";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { readGameStats } from "./useGameStats";

beforeEach(() => localStorage.clear());

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
  fireEvent.click(screen.getByRole("button", { name: /Photograph 1$/ }));
  const remembered = screen.getByRole("img").getAttribute("src");
  fireEvent.click(screen.getByRole("button", { name: "I have my photograph" }));
  expect(screen.queryByRole("img")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(screen.getByRole("region", { name: "Oracle result" })).toBeTruthy();
  expect(screen.getByRole("img")).toHaveAttribute("src", remembered);
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.getAllByRole("button", { name: /Photograph \d+$/ })).toHaveLength(3);
});

it("continues after an incorrect guess without showing the rejected candidate again", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Meet the oracle" }));
  fireEvent.click(screen.getByRole("button", { name: /Photograph 1$/ }));
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
  fireEvent.click(screen.getByRole("button", { name: /Photograph 1$/ }));
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
  expect(screen.queryByRole("button", { name: /Photograph \d+$/ })).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  for (let i = 0; i < 8 && screen.queryByRole("button", { name: "Yes" }); i++)
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep this one" }));
  expect(screen.getByRole("region", { name: "Oracle result" }).querySelector("img")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.queryByRole("button", { name: /Photograph \d+$/ })).toBeNull();
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
  expect(screen.getByText(/2 matches remain/)).toBeTruthy();
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

it("remembers discovery mode while returning to an unanswered lobby after remount", () => {
  const first = render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Find me a photograph" }));
  first.unmount();
  render(<PhotoOracle photos={photos} />);
  expect(screen.getByRole("button", { name: "Find me a photograph" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "Meet the oracle" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
});

it("uses the remembered mode for number shortcuts and undo", () => {
  localStorage.setItem("snapshots-fun-settings-v2:oracle", JSON.stringify({ mode: "discover" }));
  render(<PhotoOracle photos={photos} />);
  expect(screen.getByRole("button", { name: "Find me a photograph" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.keyDown(window, { key: "n" });
  expect(screen.queryByRole("button", { name: /Photograph \d+$/ })).toBeNull();
  const original = screen.getByRole("status").textContent;
  fireEvent.keyDown(window, { key: "3" });
  expect(screen.getByText(/1 question answered/)).toBeTruthy();
  fireEvent.keyDown(window, { key: "b" });
  expect(screen.getByRole("status").textContent).toBe(original);
});

it("keeps newest answers below the current question and removes an answer on undo", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Find me a photograph" }));
  const firstQuestion = screen.getByRole("status").textContent!;
  fireEvent.keyDown(window, { key: "3" });
  const secondQuestion = screen.getByRole("status").textContent!;
  fireEvent.keyDown(window, { key: "3" });
  const trail = screen.getByRole("region", { name: "Your answers" });
  const rows = within(trail).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent(secondQuestion);
  expect(rows[1]).toHaveTextContent(firstQuestion);
  expect(within(trail).getAllByText("Not sure")).toHaveLength(2);
  expect(
    screen.getByRole("status").compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.keyDown(window, { key: "b" });
  expect(screen.getByRole("status")).toHaveTextContent(secondQuestion);
  expect(within(trail).getAllByRole("listitem")).toHaveLength(1);
  expect(within(trail).queryByText(secondQuestion)).toBeNull();
  fireEvent.keyDown(window, { key: "b" });
  expect(screen.queryByRole("region", { name: "Your answers" })).toBeNull();
});

it("keeps the answer trail at the reveal with a clear Yes badge", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Find me a photograph" }));
  const question = screen.getByRole("status").textContent!;
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(
    within(screen.getByRole("region", { name: "Your answers" })).getByText("Yes"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep this one" }));
  const result = screen.getByRole("region", { name: "Oracle result" });
  expect(within(result).getByRole("region", { name: "Your answers" })).toHaveTextContent(question);
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.queryByRole("region", { name: "Your answers" })).toBeNull();
});

it("names each photograph to remember by its description", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Meet the oracle" }));
  expect(screen.getByRole("button", { name: /^A cat in a room/ })).toBeTruthy();
});

it("announces each question in one persistent status region and keeps the answer focused", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Find me a photograph" }));
  const status = screen.getByRole("status");
  expect(status).toHaveFocus();
  const first = status.textContent;
  const unsure = screen.getByRole("button", { name: "Not sure" });
  unsure.focus();
  fireEvent.click(unsure);
  expect(screen.getByRole("status")).toBe(status);
  expect(status.textContent).not.toBe(first);
  expect(screen.getByRole("button", { name: "Not sure" })).toHaveFocus();
});

it("records each finished round once, in either mode, and shows the record in the lobby", () => {
  const first = render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Meet the oracle" }));
  fireEvent.click(screen.getByRole("button", { name: /Photograph 1$/ }));
  fireEvent.click(screen.getByRole("button", { name: "I have my photograph" }));
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(readGameStats("oracle")).toMatchObject({ played: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Change mode" }));
  fireEvent.click(screen.getByRole("button", { name: "Find me a photograph" }));
  fireEvent.click(screen.getByRole("button", { name: "Show a match now" }));
  expect(readGameStats("oracle")).toMatchObject({ played: 2 });
  first.unmount();
  render(<PhotoOracle photos={photos} />);
  expect(screen.getByText("Played 2")).toBeInTheDocument();
});

it("offers a search for photographs like the one revealed", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Meet the oracle" }));
  fireEvent.click(screen.getByRole("button", { name: /Photograph 2$/ }));
  fireEvent.click(screen.getByRole("button", { name: "I have my photograph" }));
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  const result = screen.getByRole("region", { name: "Oracle result" });
  const shown = within(result).getByRole("img").getAttribute("src")!;
  const href = within(result)
    .getByRole("link", { name: "Similar photographs" })
    .getAttribute("href")!;
  const similar = new URL(href, "https://example.org").searchParams.get("similar")!;
  expect(similar.startsWith("../albums/test-simple/")).toBe(true);
  expect(shown).toContain(similar.split("/").at(-1));
});

it("defaults to remembering a photo and reveals the chosen photo as a reversible hint without changing the question", () => {
  render(<PhotoOracle photos={photos} />);
  expect(screen.getByRole("button", { name: "Meet the oracle" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Meet the oracle" }));
  fireEvent.click(screen.getByRole("button", { name: /Photograph 1$/ }));
  const chosen = screen.getByRole("img").getAttribute("src");
  fireEvent.click(screen.getByRole("button", { name: "I have my photograph" }));
  const question = screen.getByRole("status").textContent;
  expect(screen.queryByRole("img")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  const reminder = screen.getByRole("region", { name: "Remembered photograph" });
  expect(within(reminder).getByRole("img")).toHaveAttribute("src", chosen);
  expect(screen.getByRole("status")).toHaveTextContent(question!);
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  expect(readGameStats("oracle").played).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Hide photo" }));
  expect(screen.queryByRole("region", { name: "Remembered photograph" })).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent(question!);
});
it("does not offer a remembered-photo hint in discovery mode", () => {
  render(<PhotoOracle photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Find me a photograph" }));
  expect(screen.queryByRole("button", { name: "Hint" })).toBeNull();
});
