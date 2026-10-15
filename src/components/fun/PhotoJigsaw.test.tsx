/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PhotoJigsaw } from "./PhotoJigsaw";
import { dealJigsaw } from "../../util/photoJigsaw";
import { readGameStats } from "./useGameStats";
jest.mock("../../util/photoJigsaw", () => ({
  ...jest.requireActual("../../util/photoJigsaw"),
  dealJigsaw: jest.fn(),
}));
const Original = global.Image;
beforeEach(() => {
  localStorage.clear();
  jest
    .mocked(dealJigsaw)
    .mockReturnValue({ tiles: [1, 0, 2, 3, 4, 5, 6, 7, 8], turns: Array(9).fill(0), moves: 0 });
  global.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 800;
    naturalHeight = 800;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  } as unknown as typeof Image;
});
afterEach(() => {
  global.Image = Original;
});
it("swaps selected pieces, reveals the completed photograph and records once", async () => {
  render(
    <PhotoJigsaw
      photos={[
        {
          path: "../albums/test-simple/photo.jpg",
          href: "/album/test-simple#photo",
          caption: "A forest",
          tags: "tree",
          vector: [],
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Swap" }));
  fireEvent.click(screen.getByRole("button", { name: "Start puzzle" }));
  const first = screen.getByRole("button", { name: "Piece at row 1, column 1" });
  await waitFor(() => expect(first).toBeEnabled());
  fireEvent.click(first);
  expect(first).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Piece at row 1, column 2" }));
  expect(screen.getByRole("heading", { name: "Completed in 1 move" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "A forest" })).toBeInTheDocument();
  expect(readGameStats("photo-jigsaw").played).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(readGameStats("photo-jigsaw").played).toBe(1);
});

it("defaults to an empty grid and places pool pieces with tap or keyboard activation", async () => {
  jest.mocked(dealJigsaw).mockReturnValue({
    tiles: Array(9).fill(-1),
    turns: Array(9).fill(0),
    moves: 0,
    pool: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  });
  render(
    <PhotoJigsaw
      photos={[
        {
          path: "../albums/test-simple/photo.jpg",
          href: "/album/test-simple#photo",
          caption: "A forest",
          tags: "tree",
          vector: [],
        },
      ]}
    />,
  );
  expect(screen.getByRole("button", { name: "Jigsaw" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Start puzzle" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Pool piece 1" })).toBeEnabled());
  expect(screen.getAllByRole("button", { name: /Empty cell at row/ })).toHaveLength(9);
  for (let i = 0; i < 9; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Pool piece 1" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: `Empty cell at row ${Math.floor(i / 3) + 1}, column ${(i % 3) + 1}`,
      }),
    );
  }
  expect(screen.getByRole("heading", { name: "Completed in 9 moves" })).toBeInTheDocument();
  expect(readGameStats("photo-jigsaw").played).toBe(1);
});

it("offers a new photograph while keeping the current mode and size", async () => {
  const source = ["forest", "sea"].map((name) => ({
    path: `../albums/test-simple/${name}.jpg`,
    href: "/album/test-simple",
    caption: name,
    tags: name,
    vector: [],
  }));
  render(<PhotoJigsaw photos={source} />);
  fireEvent.click(screen.getByRole("button", { name: "Swap" }));
  fireEvent.click(screen.getByRole("radio", { name: "Square grid" }));
  fireEvent.click(screen.getByRole("button", { name: "4 × 4" }));
  fireEvent.click(screen.getByRole("button", { name: "Start puzzle" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  const previous = screen.getByRole("img").getAttribute("src");
  fireEvent.click(screen.getByRole("button", { name: "New photo" }));
  expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.getByRole("img").getAttribute("src")).not.toBe(previous);
  expect(dealJigsaw).toHaveBeenLastCalledWith(4, "swap");
  expect(readGameStats("photo-jigsaw").played).toBe(0);
});

it("allows shaped pieces in any cell and filters for edge pieces", async () => {
  jest.mocked(dealJigsaw).mockReturnValue({
    tiles: Array(9).fill(-1),
    turns: Array(9).fill(0),
    moves: 0,
    pool: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  });
  render(
    <PhotoJigsaw
      photos={[
        {
          path: "../albums/test-simple/shape.jpg",
          href: "/album/test-simple",
          caption: "A mountain",
          tags: "mountain",
          vector: [],
        },
      ]}
    />,
  );
  expect(screen.getByRole("button", { name: "Jigsaw" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Start puzzle" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Pool piece 1" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Pool piece 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Empty cell at row 1, column 2" }));
  expect(screen.getByRole("button", { name: "Piece at row 1, column 2" })).toBeEnabled();
  expect(screen.queryByRole("heading", { name: /Completed/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Piece at row 1, column 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Empty cell at row 1, column 1" }));
  expect(screen.getAllByRole("button", { name: /Pool piece/ })).toHaveLength(8);
  fireEvent.click(screen.getByRole("button", { name: "Edges only" }));
  expect(screen.getAllByRole("button", { name: /Pool piece/ })).toHaveLength(7);
});

it("accepts custom grids beyond ten and rejects fractional or out-of-range sizes", async () => {
  jest.mocked(dealJigsaw).mockReturnValue({
    tiles: Array(144).fill(-1),
    turns: Array(144).fill(0),
    moves: 0,
    pool: Array.from({ length: 144 }, (_, i) => i),
  });
  render(
    <PhotoJigsaw
      photos={[
        {
          path: "../albums/test-simple/custom.jpg",
          href: "/album/test-simple",
          caption: "Landscape",
          tags: "",
          vector: [],
        },
      ]}
    />,
  );
  const size = screen.getByRole("spinbutton", { name: "Custom grid size" });
  fireEvent.change(size, { target: { value: "12" } });
  expect(screen.getByRole("button", { name: "Start puzzle" })).toBeEnabled();
  fireEvent.change(size, { target: { value: "12.5" } });
  expect(screen.getByRole("button", { name: "Start puzzle" })).toBeDisabled();
  fireEvent.change(size, { target: { value: "51" } });
  expect(screen.getByRole("button", { name: "Start puzzle" })).toBeDisabled();
  fireEvent.change(size, { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: "Start puzzle" }));
  expect(dealJigsaw).toHaveBeenLastCalledWith(12, "jigsaw");
  await waitFor(() => expect(screen.getByRole("button", { name: "Pool piece 1" })).toBeEnabled());
});

it("adapts the default grid to retain the full landscape photograph with square pieces", async () => {
  global.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 1200;
    naturalHeight = 800;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  } as unknown as typeof Image;
  jest.mocked(dealJigsaw).mockImplementation((size, _mode, _random, rows = size) => ({
    tiles: Array(size * rows).fill(-1),
    turns: Array(size * rows).fill(0),
    pool: Array.from({ length: size * rows }, (_, i) => i),
    moves: 0,
  }));
  render(
    <PhotoJigsaw
      photos={[
        {
          path: "../albums/test-simple/wide.jpg",
          href: "/album/test-simple",
          caption: "Wide landscape",
          tags: "",
          vector: [],
        },
      ]}
    />,
  );
  expect(screen.getByRole("radio", { name: "Square pieces" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Start puzzle" }));
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: /Pool piece/ })).toHaveLength(6),
  );
  expect(screen.getAllByRole("button", { name: /Empty cell/ })).toHaveLength(6);
  expect(screen.getByText("3 × 2 · 6 pieces")).toBeInTheDocument();
});
it("rotates a selected piece with keyboard, touch buttons, right-click and wheel, keeping the turn after placement", async () => {
  jest.mocked(dealJigsaw).mockReturnValue({
    tiles: Array(9).fill(-1),
    turns: Array(9).fill(0),
    moves: 0,
    pool: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  });
  const { container } = render(
    <PhotoJigsaw
      photos={[
        {
          path: "../albums/test-simple/turn.jpg",
          href: "/album/test-simple",
          caption: "A scene",
          tags: "",
          vector: [],
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start puzzle" }));
  const piece = screen.getByRole("button", { name: "Pool piece 1" });
  await waitFor(() => expect(piece).toBeEnabled());
  fireEvent.click(piece);
  fireEvent.keyDown(piece, { key: "r" });
  expect(piece.querySelector("svg g")).toHaveAttribute("transform", "rotate(90 50 50)");
  fireEvent.click(screen.getByRole("button", { name: "Rotate right" }));
  fireEvent.contextMenu(piece);
  expect(piece.querySelector("svg g")).toHaveAttribute("transform", "rotate(270 50 50)");
  fireEvent.keyDown(piece, { key: "q" });
  fireEvent.wheel(container.firstElementChild!, { deltaY: 120 });
  expect(piece.querySelector("svg g")).toHaveAttribute("transform", "rotate(270 50 50)");
  fireEvent.click(screen.getByRole("button", { name: "Empty cell at row 1, column 2" }));
  const placed = screen.getByRole("button", { name: "Piece at row 1, column 2" });
  expect(placed.querySelector("svg g")).toHaveAttribute("transform", "rotate(270 50 50)");
  fireEvent.click(placed);
  fireEvent.click(screen.getByRole("button", { name: "Rotate left" }));
  expect(placed.querySelector("svg g")).toHaveAttribute("transform", "rotate(180 50 50)");
});
