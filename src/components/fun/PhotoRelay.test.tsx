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
    within(screen.getByRole("region", { name: "Relay result" })).getAllByText(
      /\d+ → \d+ · .*% similarity/,
    ),
  ).toHaveLength(6);
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
