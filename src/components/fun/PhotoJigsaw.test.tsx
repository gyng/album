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
    naturalWidth = 1200;
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
