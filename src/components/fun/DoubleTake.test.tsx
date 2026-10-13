/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DoubleTake } from "./DoubleTake";
import { buildDoubleTakeDeck } from "../../util/doubleTake";
import type { PhotoGamePhoto } from "../../util/photoGames";

jest.mock("../../util/doubleTake", () => ({
  ...jest.requireActual("../../util/doubleTake"),
  buildDoubleTakeDeck: jest.fn(),
}));
const photos: PhotoGamePhoto[] = Array.from({ length: 4 }, (_, index) => ({
  path: `../albums/test-simple/${index}.jpg`,
  href: `/album/test-simple#${index}`,
  caption: `Secret subject ${index}`,
  tags: "",
  vector: [1],
  location: { lat: 1, lng: 2, date: "2020-01-01T12:00:00", label: `Secret place ${index}` },
}));
const deck = [
  {
    photos: [photos[0]!, photos[1]!] as [PhotoGamePhoto, PhotoGamePhoto],
    samePlace: true,
    distanceMetres: 20,
    similarity: 0.8,
  },
  {
    photos: [photos[2]!, photos[3]!] as [PhotoGamePhoto, PhotoGamePhoto],
    samePlace: false,
    distanceMetres: 8000,
    similarity: 0.8,
  },
];
let hidden = false;
let images: Array<{
  onload: (() => void) | null;
  onerror: (() => void) | null;
  decode: () => Promise<void>;
  decoded: () => void;
}>;
const originalImage = global.Image;
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  jest.useFakeTimers();
  hidden = false;
  images = [];
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  global.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = "";
    decoded!: () => void;
    pending = new Promise<void>((resolve) => {
      this.decoded = resolve;
    });
    decode = () => this.pending;
    constructor() {
      images.push(this);
    }
  } as unknown as typeof Image;
  jest.mocked(buildDoubleTakeDeck).mockReturnValue(deck);
});
afterEach(() => {
  global.Image = originalImage;
  jest.useRealTimers();
});
const start = () => {
  render(<DoubleTake photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start Double Take" }));
  act(() => {
    jest.advanceTimersByTime(0);
  });
};
const ready = async () => {
  await act(async () => {
    images.slice(-2).forEach((image) => {
      image.onload?.();
      image.decoded();
    });
  });
};
const tick = (milliseconds: number) =>
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
const watch = async (duration = 1000) => {
  await ready();
  tick(duration);
  tick(duration);
};

it("waits for both photographs to decode, hides spoilers and reveals the actual places after a guess", async () => {
  start();
  await act(async () => {
    images[0]!.onload?.();
    images[0]!.decoded();
    images[1]!.onload?.();
  });
  tick(10000);
  expect(screen.getByRole("status")).toHaveTextContent("Preparing");
  await act(async () => images[1]!.decoded());
  expect(screen.getByRole("img", { name: "Photograph 1" })).toBeTruthy();
  expect(screen.queryByText(/Secret place/)).toBeNull();
  expect(screen.queryByRole("img", { name: /Secret subject/ })).toBeNull();
  tick(1000);
  expect(screen.getByRole("img", { name: "Photograph 2" })).toBeTruthy();
  tick(1000);
  expect(screen.queryByRole("img")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Same place" }));
  expect(screen.getByRole("region", { name: "Pair revealed" })).toHaveTextContent(
    "20 metres apart",
  );
  expect(screen.getByText("Secret place 0")).toBeTruthy();
  expect(screen.getByText("+100 points")).toBeTruthy();
});

it("shows preparation before computing the deck and cancels it when leaving", () => {
  const view = render(<DoubleTake photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start Double Take" }));
  expect(screen.getByRole("status")).toHaveTextContent("Finding");
  expect(buildDoubleTakeDeck).not.toHaveBeenCalled();
  view.unmount();
  tick(0);
  expect(buildDoubleTakeDeck).not.toHaveBeenCalled();
});

it("retains a three-second look when the longer viewing option is selected", async () => {
  render(<DoubleTake photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: /Longer look/ }));
  fireEvent.click(screen.getByRole("button", { name: "Start Double Take" }));
  tick(0);
  await ready();
  tick(2999);
  expect(screen.getByRole("img", { name: "Photograph 1" })).toBeTruthy();
  tick(1);
  expect(screen.getByRole("img", { name: "Photograph 2" })).toBeTruthy();
  tick(3000);
  expect(screen.getByRole("button", { name: "Same place" })).toBeTruthy();
});

it("times out a stalled load or decode and lets the player retry", async () => {
  start();
  await act(async () => {
    images[0]!.onload?.();
    images[0]!.decoded();
    images[1]!.onload?.();
  });
  await act(async () => {
    jest.advanceTimersByTime(15000);
  });
  expect(screen.getByRole("alert")).toHaveTextContent("couldn’t load");
  expect(images.every((image) => image.onload === null && image.onerror === null)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Retry photographs" }));
  await ready();
  expect(screen.getByRole("img", { name: "Photograph 1" })).toBeTruthy();
});

it("awards accuracy and streak points while replay removes the bonus", async () => {
  start();
  await watch();
  fireEvent.click(screen.getByRole("button", { name: "Same place" }));
  fireEvent.click(screen.getByRole("button", { name: "Next pair" }));
  await watch(900);
  fireEvent.click(screen.getByRole("button", { name: "Replay pair" }));
  await watch(900);
  fireEvent.click(screen.getByRole("button", { name: "Different places" }));
  expect(screen.getByText("+100 points")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "See results" }));
  expect(screen.getByRole("region", { name: "Double Take results" })).toHaveTextContent(
    "2 of 2 correct · 200 points",
  );
});

it("requires a fresh watch after a hidden-tab interruption without advancing in the background", async () => {
  start();
  await ready();
  tick(500);
  act(() => {
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  tick(10000);
  expect(screen.queryByRole("img")).toBeNull();
  act(() => {
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(screen.getByRole("button", { name: "Watch again" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Watch again" }));
  await ready();
  expect(screen.getByRole("img", { name: "Photograph 1" })).toBeTruthy();
  tick(999);
  expect(screen.getByRole("img", { name: "Photograph 1" })).toBeTruthy();
  tick(1);
  expect(screen.getByRole("img", { name: "Photograph 2" })).toBeTruthy();
});

it("recovers from an image error and gives up without awarding points", async () => {
  start();
  await act(async () => images[0]!.onerror?.());
  expect(screen.getByRole("alert")).toHaveTextContent("couldn’t load");
  fireEvent.click(screen.getByRole("button", { name: "Retry photographs" }));
  await watch();
  fireEvent.click(screen.getByRole("button", { name: "Give up this pair" }));
  expect(screen.getByText("No points this round")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Pair revealed" })).toHaveTextContent("Same place");
});

it("remembers longer viewing time after remount and returns to the lobby", () => {
  const first = render(<DoubleTake photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Longer look · off" }));
  first.unmount();
  render(<DoubleTake photos={photos} />);
  expect(screen.getByRole("button", { name: "Longer look · 3 seconds" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "Start Double Take" })).toBeTruthy();
});
