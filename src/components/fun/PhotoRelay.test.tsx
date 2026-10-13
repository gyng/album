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
  expect(screen.getByRole("button", { name: "Choose photograph 2" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Undo last link" }));
  expect(first).toBeEnabled();
  expect(first).toHaveFocus();
  for (let i = 1; i <= 5; i++)
    fireEvent.click(screen.getByRole("button", { name: `Choose photograph ${i}` }));
  expect(screen.queryByRole("region", { name: "Relay result" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Finish relay" }));
  const result = screen.getByRole("region", { name: "Relay result" });
  expect(within(result).getByText(/Visual flow: \d+ \/ 100/)).toBeTruthy();
  expect(within(result).getAllByRole("list")[0]?.children).toHaveLength(7);
});

it("supports moving and removing links with buttons and reveals transition similarities", () => {
  render(<PhotoRelay photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start relay" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose photograph 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose photograph 2" }));
  const links = screen.getByRole("list", { name: "Your relay links" });
  const first = within(links).getAllByRole("img")[0]!.getAttribute("src");
  fireEvent.click(screen.getByRole("button", { name: "Move link 1 later" }));
  expect(within(links).getAllByRole("img")[1]).toHaveAttribute("src", first);
  fireEvent.click(screen.getByRole("button", { name: "Remove link 2" }));
  expect(screen.getByRole("status")).toHaveTextContent("1 of 5");
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(
    within(
      within(screen.getByRole("region", { name: "Relay result" })).getAllByRole("list")[0]!,
    ).getAllByText(/\d+ → \d+ · .*% similarity/),
  ).toHaveLength(6);
  const explanations = screen.getByRole("list", { name: "Relay connections" });
  expect(within(explanations).getAllByRole("listitem")).toHaveLength(6);
  expect(within(explanations).getAllByText("No shared indexed subject")).toHaveLength(6);
  expect(screen.getByText("Your unfinished route")).toBeInTheDocument();
});

it("returns keyboard players from the photo tray to the editable links", () => {
  render(<PhotoRelay photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start relay" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose photograph 1" }));
  const remove = screen.getByRole("button", { name: "Remove link 1" });
  remove.scrollIntoView = jest.fn();
  fireEvent.click(screen.getByRole("button", { name: "Edit links" }));
  expect(remove).toHaveFocus();
  fireEvent.click(remove);
  expect(screen.getByRole("status")).toHaveTextContent("0 of 5");
});

it("only accepts its active drag and clears the target after cancelling", () => {
  render(<PhotoRelay photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start relay" }));
  const choice = screen.getByRole("button", { name: "Choose photograph 1" });
  const slots = within(screen.getByRole("list", { name: "Your relay links" })).getAllByRole(
    "listitem",
  );
  const values = new Map<string, string>();
  const transfer = {
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
  fireEvent.dragStart(choice, { dataTransfer: transfer });
  fireEvent.dragOver(slots[2]!, { dataTransfer: transfer });
  expect(slots[2]).toHaveAttribute("data-drop-hover", "true");
  fireEvent.dragEnd(choice);
  expect(slots[2]).toHaveAttribute("data-drop-hover", "false");
  fireEvent.drop(slots[2]!, { dataTransfer: transfer });
  expect(screen.getByRole("status")).toHaveTextContent("0 of 5");
  fireEvent.dragStart(choice, { dataTransfer: transfer });
  fireEvent.dragOver(slots[2]!, { dataTransfer: transfer });
  fireEvent.drop(slots[2]!, { dataTransfer: transfer });
  expect(screen.getByRole("status")).toHaveTextContent("1 of 5");
  expect(choice).toBeDisabled();
  expect(slots[2]).toHaveAttribute("data-drop-hover", "false");
});

it("keeps finish disabled until the chain is full and supports round shortcuts", () => {
  render(<PhotoRelay photos={photos} />);
  fireEvent.keyDown(document.body, { key: "n" });
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(screen.queryByRole("region", { name: "Relay result" })).toBeNull();
  for (let i = 1; i <= 5; i++)
    fireEvent.click(screen.getByRole("button", { name: `Choose photograph ${i}` }));
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(screen.getByRole("region", { name: "Relay result" })).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: "n" });
  expect(screen.getByRole("status")).toHaveTextContent("0 of 5");
  fireEvent.keyDown(document.body, { key: "g" });
  expect(screen.getByRole("region", { name: "Relay result" })).toBeInTheDocument();
});
