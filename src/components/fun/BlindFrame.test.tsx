/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { BlindFrame } from "./BlindFrame";
import { encodeSearchImage } from "../search/imageEmbeddings";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { readGameStats } from "./useGameStats";

jest.mock("../search/imageEmbeddings", () => ({ encodeSearchImage: jest.fn() }));
jest.mock("../search/SearchDrawPad", () => ({
  SearchDrawPad: ({
    onSubmit,
    onCancel,
    inline,
  }: {
    inline?: boolean;
    onSubmit: (blob: Blob) => void;
    onCancel: () => void;
  }) => (
    <div role={inline ? "region" : "dialog"} aria-label="Blind Frame sketch">
      <button onClick={() => onSubmit(new Blob(["sketch"], { type: "image/png" }))}>
        Submit sketch
      </button>
      <button onClick={onCancel}>Cancel sketch</button>
    </div>
  ),
}));
const photos: PhotoGamePhoto[] = [
  "A boat on the river beside a tree.",
  "A person on a quiet city street.",
].map((caption, i) => ({
  path: `../albums/test-simple/${i}.jpg`,
  href: `/album/test-simple#${i}.jpg`,
  caption,
  tags: "",
  vector: i === 0 ? [1, 0] : [0, 1],
}));

const revokePreview = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  URL.createObjectURL = jest.fn(() => "blob:sketch");
  URL.revokeObjectURL = revokePreview;
});

it("keeps the target hidden until the sketch is submitted, then compares all three images and scores it", async () => {
  render(<BlindFrame photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start Blind Frame" }));
  const target = photos.find((photo) => screen.queryByText(photo.caption))!;
  expect(screen.queryByRole("img")).toBeNull();
  jest.mocked(encodeSearchImage).mockResolvedValue([...target.vector]);
  fireEvent.click(screen.getByRole("button", { name: "Draw this scene" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Submit sketch" }));
  });
  expect(screen.getByRole("region", { name: "Blind Frame result" })).toBeTruthy();
  expect(screen.getByText("Resemblance to the original: 100 / 100")).toBeTruthy();
  expect(screen.getAllByRole("img")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  expect(screen.queryByRole("img")).toBeNull();
  expect(revokePreview).toHaveBeenCalledWith("blob:sketch");
});

it("does not submit a cancelled sketch", () => {
  render(<BlindFrame photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start Blind Frame" }));
  fireEvent.click(screen.getByRole("button", { name: "Draw this scene" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel sketch" }));
  expect(encodeSearchImage).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("allows giving up while matching a sketch and ignores its late completion", async () => {
  let complete!: (vector: number[]) => void;
  jest.mocked(encodeSearchImage).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  render(<BlindFrame photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start Blind Frame" }));
  fireEvent.click(screen.getByRole("button", { name: "Draw this scene" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit sketch" }));
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(screen.getByRole("region", { name: "Blind Frame result" })).toHaveFocus();
  expect(screen.getAllByRole("img")).toHaveLength(2);
  await act(async () => complete([1, 0]));
  expect(screen.queryByText(/\/ 100/)).toBeNull();
  expect(screen.getAllByRole("img")).toHaveLength(2);
});

it("gives up from the keyboard like the button: the reveal takes focus and a late match is ignored", async () => {
  let complete!: (vector: number[]) => void;
  jest.mocked(encodeSearchImage).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  render(<BlindFrame photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start Blind Frame" }));
  fireEvent.click(screen.getByRole("button", { name: "Draw this scene" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit sketch" }));
  fireEvent.keyDown(document.body, { key: "g" });
  const reveal = screen.getByRole("region", { name: "Blind Frame result" });
  expect(reveal).toHaveFocus();
  await act(async () => complete([1, 0]));
  expect(screen.queryByText(/\/ 100/)).toBeNull();
  expect(reveal).toHaveFocus();
});

it("does not open the sketch from the keyboard while a sketch is being compared", () => {
  jest.mocked(encodeSearchImage).mockReturnValue(new Promise(() => {}));
  render(<BlindFrame photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start Blind Frame" }));
  fireEvent.click(screen.getByRole("button", { name: "Draw this scene" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit sketch" }));
  expect(screen.getByRole("button", { name: "Draw this scene" })).toBeDisabled();
  fireEvent.keyDown(document.body, { key: "d" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

const desktop = () =>
  jest.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));

it("offers the desktop pad again when a sketch cannot be compared", async () => {
  const match = desktop();
  try {
    jest.mocked(encodeSearchImage).mockResolvedValue([1, 0, 0]);
    render(<BlindFrame photos={photos} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Blind Frame" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit sketch" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("could not be compared");
    expect(screen.getByRole("region", { name: "Blind Frame sketch" })).toBeTruthy();
  } finally {
    match.mockRestore();
  }
});

it("opens the drawing pad as soon as a desktop round starts", () => {
  const match = desktop();
  try {
    render(<BlindFrame photos={photos} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Blind Frame" }));
    expect(screen.getByRole("region", { name: "Blind Frame sketch" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Draw this scene" })).toBeNull();
  } finally {
    match.mockRestore();
  }
});

it("keeps a busy comparison status after the image model reports ready", () => {
  jest.mocked(encodeSearchImage).mockImplementation((_blob, progress) => {
    progress?.(100, "Image search model ready");
    return new Promise(() => {});
  });
  render(<BlindFrame photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start Blind Frame" }));
  fireEvent.click(screen.getByRole("button", { name: "Draw this scene" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit sketch" }));
  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("aria-busy", "true");
  expect(status).toHaveTextContent("Comparing your drawing");
  expect(status).not.toHaveTextContent("model ready");
});

it("records each reveal once, winning when the drawing's closest match is the original", async () => {
  const view = render(
    <StrictMode>
      <BlindFrame photos={photos} />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start Blind Frame" }));
  const target = photos.find((photo) => screen.queryByText(photo.caption))!;
  jest.mocked(encodeSearchImage).mockResolvedValue([...target.vector]);
  fireEvent.click(screen.getByRole("button", { name: "Draw this scene" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Submit sketch" }));
  });
  expect(readGameStats("blind-frame")).toMatchObject({ played: 1, won: 1, best: 100 });
  const result = screen.getByRole("region", { name: "Blind Frame result" });
  const href = within(result)
    .getByRole("link", { name: "Similar photographs" })
    .getAttribute("href")!;
  expect(new URL(href, "https://example.org").searchParams.get("similar")).toBe(target.path);

  fireEvent.click(screen.getByRole("button", { name: "Play again" }));
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  expect(readGameStats("blind-frame")).toMatchObject({ played: 2, won: 1, best: 100 });
  view.unmount();
  render(<BlindFrame photos={photos} />);
  expect(screen.getByText("Played 2 · won 1 · best 100/100")).toBeInTheDocument();
});
