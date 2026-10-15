/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DoubleTake } from "./DoubleTake";
import { buildDoubleTakeDeck, prepareDoubleTakePairs } from "../../util/doubleTake";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { readGameStats } from "./useGameStats";

jest.mock("../../util/doubleTake", () => ({
  ...jest.requireActual("../../util/doubleTake"),
  buildDoubleTakeDeck: jest.fn(),
  prepareDoubleTakePairs: jest.fn(),
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
  jest.mocked(prepareDoubleTakePairs).mockReturnValue(true);
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

it("keeps Cancel working while a first comparison is still in progress", () => {
  jest.mocked(prepareDoubleTakePairs).mockReturnValue(false);
  render(<DoubleTake photos={photos} />);
  fireEvent.click(screen.getByRole("button", { name: "Start Double Take" }));
  tick(0);
  tick(1);
  expect(prepareDoubleTakePairs).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  tick(10);
  expect(prepareDoubleTakePairs).toHaveBeenCalledTimes(2);
  expect(buildDoubleTakeDeck).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Start Double Take" })).toBeTruthy();
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

it("reports correct and incorrect picks immediately while keeping the reveal focused", async () => {
  start();
  await watch();
  fireEvent.click(screen.getByRole("button", { name: "Same place" }));
  expect(screen.getByRole("status")).toHaveTextContent("Correct");
  expect(screen.getByRole("region", { name: "Pair revealed" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Next pair" }));
  await watch(900);
  fireEvent.click(screen.getByRole("button", { name: "Same place" }));
  expect(screen.getByRole("status")).toHaveTextContent("Not quite");
  expect(screen.getByRole("region", { name: "Pair revealed" })).toHaveFocus();
  expect(screen.getByRole("region", { name: "Pair revealed" })).toHaveTextContent(
    "Different places",
  );
});

it("brings focus back to the question once a new pair has been shown", async () => {
  start();
  await watch();
  fireEvent.click(screen.getByRole("button", { name: "Same place" }));
  const nextPair = screen.getByRole("button", { name: "Next pair" });
  nextPair.focus();
  fireEvent.click(nextPair);
  await watch(900);
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement).toContainElement(
    screen.getByRole("heading", { name: "Same place?" }),
  );
});

it("offers keyboard picks only after watching and advances a revealed pair", async () => {
  render(<DoubleTake photos={photos} />);
  fireEvent.keyDown(document.body, { key: "n" });
  tick(0);
  fireEvent.keyDown(document.body, { key: "1" });
  expect(screen.queryByRole("region", { name: "Pair revealed" })).toBeNull();
  await watch();
  fireEvent.keyDown(document.body, { key: "1" });
  expect(screen.getByRole("status")).toHaveTextContent("Correct");
  fireEvent.keyDown(document.body, { key: "2" });
  expect(screen.getByText("+100 points")).toBeTruthy();
  fireEvent.keyDown(document.body, { key: " " });
  await watch(900);
  fireEvent.keyDown(document.body, { key: "2" });
  expect(screen.getByRole("status")).toHaveTextContent("Correct");
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(screen.getByRole("region", { name: "Double Take results" })).toHaveTextContent(
    "2 of 2 correct",
  );
});

it("records a finished game once, scored by correct answers, and leads on from its photographs", async () => {
  start();
  await watch();
  fireEvent.click(screen.getByRole("button", { name: "Same place" }));
  fireEvent.click(screen.getByRole("button", { name: "Next pair" }));
  expect(readGameStats("double-take").played).toBe(0);
  await watch(900);
  fireEvent.click(screen.getByRole("button", { name: "Same place" }));
  fireEvent.click(screen.getByRole("button", { name: "See results" }));
  expect(readGameStats("double-take")).toMatchObject({ played: 1, won: 0, best: 1 });

  const results = screen.getByRole("region", { name: "Double Take results" });
  const guess = within(results).getByRole("link", { name: "Guess where these were taken" });
  expect(
    new URL(guess.getAttribute("href")!, "https://example.org").searchParams.getAll("photos"),
  ).toEqual(photos.map((photo) => photo.path));

  fireEvent.click(screen.getByRole("button", { name: "Change viewing time" }));
  expect(screen.getByText("Played 1 · won 0 · best 1 correct")).toBeInTheDocument();
});

it("reviews every played pair with the player's answer, actual places and points", async () => {
  start();
  await watch();
  fireEvent.click(screen.getByRole("button", { name: "Same place" }));
  fireEvent.click(screen.getByRole("button", { name: "Next pair" }));
  await watch(900);
  fireEvent.click(screen.getByRole("button", { name: "Same place" }));
  fireEvent.click(screen.getByRole("button", { name: "See results" }));
  const first = screen.getByRole("region", { name: "Pair 1" });
  expect(within(first).getAllByRole("img")).toHaveLength(2);
  expect(first).toHaveTextContent("Correct");
  expect(first).toHaveTextContent("100 points");
  expect(first).toHaveTextContent("20 metres apart");
  expect(first).toHaveTextContent("Your answer: Same place");
  const second = screen.getByRole("region", { name: "Pair 2" });
  expect(second).toHaveTextContent("Incorrect");
  expect(second).toHaveTextContent("Different places");
  expect(second).toHaveTextContent("8.0 km apart");
  expect(second).toHaveTextContent("0 points");
  expect(within(second).getAllByRole("link")).toHaveLength(2);
});
it("distinguishes skipped pairs from incorrect guesses in the results", async () => {
  start();
  await watch();
  fireEvent.click(screen.getByRole("button", { name: "Give up this pair" }));
  fireEvent.click(screen.getByRole("button", { name: "Next pair" }));
  await watch();
  fireEvent.click(screen.getByRole("button", { name: "Different places" }));
  fireEvent.click(screen.getByRole("button", { name: "See results" }));
  expect(screen.getByRole("region", { name: "Pair 1" })).toHaveTextContent("Skipped");
  expect(screen.getByRole("region", { name: "Pair 2" })).toHaveTextContent("Correct");
});
