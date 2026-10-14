/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { distanceMetersBetween } from "../mapRoute";
import { fireConfetti } from "./confetti";
import { GuessRound, type RoundResult } from "./GuessRound";
import type { GuessPhoto } from "./guessTypes";
import { GuessMap } from "./GuessMap";
import { computeScore } from "./guessScoring";

jest.mock("../mapRoute", () => ({
  distanceMetersBetween: jest.fn(),
}));

// The map surface stands in for MapLibre's focusable canvas container.
jest.mock("../map", () => ({
  __esModule: true,
  MapView: ({ children }: React.PropsWithChildren) => (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div data-testid="map-surface" tabIndex={0}>
      {children}
    </div>
  ),
  Marker: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DataLayer: () => null,
  useMap: () => undefined,
}));

jest.mock("./confetti", () => ({
  fireConfetti: jest.fn(),
}));

jest.mock("./useAnimatedCounter", () => ({
  useAnimatedCounter: (target: number) => (node: HTMLElement | null) => {
    if (node) node.textContent = target.toLocaleString("en-GB");
  },
}));

const distanceMetersBetweenMock = jest.mocked(distanceMetersBetween);
const fireConfettiMock = jest.mocked(fireConfetti);

const firstPhoto: GuessPhoto = {
  path: "../albums/test-simple/first.jpg",
  albumName: "test-simple",
  photoName: "first.jpg",
  lat: 35,
  lng: 139,
  geocode: "JP\nTokyo\nJapan",
};

const secondPhoto: GuessPhoto = {
  ...firstPhoto,
  path: "../albums/test-simple/second.jpg",
  photoName: "second.jpg",
  geocode: "Singapore",
};

const baseProps = {
  photo: firstPhoto,
  roundNumber: 1,
  totalRounds: 3,
  cumulativeScore: 200,
  timeLimit: null,
  guess: { lat: 35.01, lng: 139.01 },
  onComplete: jest.fn<void, [RoundResult]>(),
  onReveal: jest.fn(),
  onAbort: jest.fn(),
  mapSlot: <div>Map slot</div>,
};

const renderRound = (overrides: Partial<React.ComponentProps<typeof GuessRound>> = {}) => {
  const props = {
    ...baseProps,
    onComplete: jest.fn<void, [RoundResult]>(),
    onReveal: jest.fn(),
    onAbort: jest.fn(),
    ...overrides,
  };
  const view = render(<GuessRound {...props} />);
  return { ...view, props };
};

const mysteryPanel = () =>
  screen.getByRole("img", {
    name: "Mystery photo. Use plus and minus to zoom, arrow keys to pan.",
  });

const dispatchPointer = (
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  pointerId: number,
  clientX: number,
  clientY: number,
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  fireEvent(target, event);
};

describe("GuessRound", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: jest.fn(),
    });
  });

  beforeEach(() => {
    distanceMetersBetweenMock.mockReturnValue(1_000);
    fireConfettiMock.mockClear();
  });

  it("confirms a close guess, reveals its score, and completes the round", () => {
    const { props } = renderRound();

    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));

    expect(distanceMetersBetweenMock).toHaveBeenCalledWith(
      { decLat: 35.01, decLng: 139.01 },
      { decLat: 35, decLng: 139 },
    );
    expect(props.onReveal).toHaveBeenCalledTimes(1);
    expect(fireConfettiMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1.0 km")).toBeInTheDocument();
    expect(screen.getByText("Tokyo, Japan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(props.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        photo: firstPhoto,
        distanceMeters: 1_000,
        skipped: false,
      }),
    );
  });

  it("reveals a poor timed guess without confetti and shows its time bonus", () => {
    jest.useFakeTimers();
    distanceMetersBetweenMock.mockReturnValue(450_000);
    const { props, container } = renderRound({ timeLimit: 30, roundNumber: 3, totalRounds: 3 });
    fireEvent.load(container.querySelector("img")!);
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));

    expect(fireConfettiMock).not.toHaveBeenCalled();
    expect(props.onReveal).toHaveBeenCalledTimes(1);
    expect(screen.getByText("450 km")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /See results/ })).toBeInTheDocument();
    expect(screen.getAllByText(/^\+/)).toHaveLength(2);
    jest.useRealTimers();
  });

  it("skips a round and reports the skipped result", () => {
    const { props } = renderRound({ guess: null, photo: { ...firstPhoto, geocode: "" } });

    expect(screen.getByRole("button", { name: /Confirm/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "I have no idea" }));

    expect(props.onReveal).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.queryByText("Tokyo, Japan")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(props.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        distanceMeters: Infinity,
        distanceScore: 0,
        timeBonus: 0,
        score: 0,
        skipped: true,
      }),
    );
  });

  it("waits for the photo before starting the timer, then skips on expiry", () => {
    jest.useFakeTimers();
    const { props, container } = renderRound({ guess: null, timeLimit: 4 });

    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(props.onReveal).not.toHaveBeenCalled();
    expect(container.querySelector("[data-warning]")).toBeNull();

    fireEvent.load(container.querySelector("img")!);
    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    expect(container.querySelector("[data-warning]")).not.toBeNull();
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(container.querySelector("[data-urgent]")).not.toBeNull();
    act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(props.onReveal).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("auto-confirms the current guess when a loaded photo timer expires", () => {
    jest.useFakeTimers();
    const { props, container } = renderRound({ timeLimit: 1 });
    fireEvent.load(container.querySelector("img")!);

    act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(props.onReveal).toHaveBeenCalledTimes(1);
    expect(distanceMetersBetweenMock).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("supports wheel, keyboard, drag, pinch, and reset controls on the photo", () => {
    const { container } = renderRound();
    const panel = mysteryPanel();
    const image = container.querySelector("img")!;

    fireEvent.keyDown(panel, { key: "ArrowLeft" });
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(image.style.transform).toContain("scale(1)");

    dispatchPointer(panel, "pointerdown", 1, 0, 0);
    dispatchPointer(panel, "pointermove", 1, 10, 10);
    dispatchPointer(panel, "pointerdown", 2, 100, 0);
    dispatchPointer(panel, "pointerup", 2, 100, 0);
    dispatchPointer(panel, "pointerup", 1, 10, 10);

    fireEvent.wheel(panel, { deltaY: -1 });
    expect(image.style.transform).toContain("scale(1.15)");
    dispatchPointer(panel, "pointerdown", 1, 10, 20);
    dispatchPointer(panel, "pointermove", 99, 50, 60);
    dispatchPointer(panel, "pointermove", 1, 30, 50);
    expect(image.style.transform).toContain("translate(");
    dispatchPointer(panel, "pointerup", 1, 30, 50);

    dispatchPointer(panel, "pointerdown", 1, 0, 0);
    dispatchPointer(panel, "pointerdown", 2, 100, 0);
    dispatchPointer(panel, "pointerdown", 3, 50, 50);
    dispatchPointer(panel, "pointerup", 3, 50, 50);
    dispatchPointer(panel, "pointermove", 2, 0, 0);
    dispatchPointer(panel, "pointermove", 2, 1, 0);
    dispatchPointer(panel, "pointermove", 2, 100, 0);
    dispatchPointer(panel, "pointermove", 2, 200, 0);
    expect(image.style.transform).toContain("scale(2.3)");
    dispatchPointer(panel, "pointerup", 2, 200, 0);
    dispatchPointer(panel, "pointermove", 1, 25, 25);
    dispatchPointer(panel, "pointercancel", 1, 25, 25);

    fireEvent.keyDown(panel, { key: "+" });
    fireEvent.keyDown(panel, { key: "=" });
    fireEvent.keyDown(panel, { key: "ArrowUp" });
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    fireEvent.keyDown(panel, { key: "ArrowLeft" });
    fireEvent.keyDown(panel, { key: "ArrowRight" });
    fireEvent.keyDown(panel, { key: "-" });
    fireEvent.keyDown(panel, { key: "_" });
    fireEvent.keyDown(panel, { key: "0" });
    expect(image.style.transform).toBe("scale(1) translate(0px, 0px)");

    fireEvent.keyDown(panel, { key: "+" });
    fireEvent.keyDown(panel, { key: "-" });

    fireEvent.wheel(panel, { deltaY: 1 });
    fireEvent.doubleClick(panel);
    expect(image.style.transform).toBe("scale(1) translate(0px, 0px)");
  });

  it("uses global shortcuts without hijacking focused controls or the photo panel", () => {
    const { props } = renderRound();
    const panel = mysteryPanel();
    const skip = screen.getByRole("button", { name: "I have no idea" });

    fireEvent.keyDown(skip, { key: "Enter" });
    fireEvent.keyDown(panel, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onReveal).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Enter" });
    expect(props.onReveal).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(props.onComplete).toHaveBeenCalledTimes(3);
  });

  it("resets round-local state when the photo changes", () => {
    const { rerender, container } = renderRound();
    fireEvent.load(container.querySelector("img")!);
    fireEvent.wheel(mysteryPanel(), { deltaY: -1 });
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    expect(screen.getByText("Tokyo, Japan")).toBeInTheDocument();

    rerender(<GuessRound {...baseProps} photo={secondPhoto} roundNumber={2} />);

    expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument();
    expect(screen.queryByText("Tokyo, Japan")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/data/albums/test-simple/.resized_images/second.jpg%401600.avif",
    );
    expect(container.querySelector("img")?.style.transform).toBe("scale(1) translate(0px, 0px)");
  });

  it.each([
    ["   \n", null],
    ["Singapore", "Singapore"],
    ["SG\nSingapore", "Singapore"],
  ])("renders geocode %p as %p after reveal", (geocode, label) => {
    renderRound({ photo: { ...firstPhoto, geocode } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));

    if (label) expect(screen.getByText(label)).toBeInTheDocument();
    else expect(screen.queryByText("Singapore")).not.toBeInTheDocument();
  });

  it("awards no time bonus when the timer runs out on a placed guess", () => {
    jest.useFakeTimers();
    const { props, container } = renderRound({ timeLimit: 15 });
    fireEvent.load(container.querySelector("img")!);

    act(() => {
      jest.advanceTimersByTime(15_000);
    });
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));

    const result = jest.mocked(props.onComplete).mock.calls[0]![0];
    expect(result.timeBonus).toBe(0);
    expect(result.score).toBe(result.distanceScore);
    jest.useRealTimers();
  });

  it("separates the distance score from the time bonus in the reveal", () => {
    jest.useFakeTimers();
    distanceMetersBetweenMock.mockReturnValue(450_000);
    const { container } = renderRound({ timeLimit: 30 });
    fireEvent.load(container.querySelector("img")!);
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));

    const distanceScore = computeScore(450);
    expect(screen.getByText(distanceScore.toLocaleString("en-GB"))).toBeInTheDocument();
    expect(screen.getByText("+967 time bonus")).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("ignores held-key repeats and modified shortcuts", () => {
    const { props } = renderRound();

    fireEvent.keyDown(window, { key: "Enter", altKey: true });
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(props.onReveal).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Enter" });
    expect(props.onReveal).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Enter", repeat: true });
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    expect(props.onComplete).not.toHaveBeenCalled();
  });

  it("ignores shortcuts already handled or behind an open dialog", () => {
    const { props } = renderRound();
    const handled = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(props.onReveal).not.toHaveBeenCalled();

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(props.onReveal).not.toHaveBeenCalled();
    dialog.remove();
  });

  it("leaves Space and the arrow keys to a focused map after the reveal", () => {
    const { props } = renderRound({
      mapSlot: <GuessMap guess={{ lat: 35.01, lng: 139.01 }} onGuess={jest.fn()} />,
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));

    const surface = screen.getByTestId("map-surface");
    fireEvent.keyDown(surface, { key: " " });
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    expect(props.onComplete).not.toHaveBeenCalled();

    fireEvent.keyDown(surface, { key: "Enter" });
    expect(props.onComplete).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the result on reveal and to the photo on a new round", () => {
    const { rerender } = renderRound();
    expect(mysteryPanel()).toHaveFocus();

    const confirm = screen.getByRole("button", { name: /Confirm/ });
    confirm.focus();
    fireEvent.click(confirm);

    expect(screen.getByRole("group", { name: "Result" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("1.0 km away");

    rerender(<GuessRound {...baseProps} photo={secondPhoto} roundNumber={2} />);
    expect(mysteryPanel()).toHaveFocus();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("claims the wheel to zoom the photo instead of scrolling the page", () => {
    const { container } = renderRound();
    const wheel = new WheelEvent("wheel", { deltaY: -1, bubbles: true, cancelable: true });
    act(() => {
      mysteryPanel().dispatchEvent(wheel);
    });

    expect(wheel.defaultPrevented).toBe(true);
    expect(container.querySelector("img")!.style.transform).toContain("scale(1.15)");
  });

  it("reports a photo that fails to load and lets the player skip it", () => {
    jest.useFakeTimers();
    const { props, container } = renderRound({ guess: null, timeLimit: 15 });
    fireEvent.error(container.querySelector("img")!);

    expect(screen.getByRole("alert")).toHaveTextContent("This photo could not be loaded.");
    act(() => {
      jest.advanceTimersByTime(20_000);
    });
    expect(props.onReveal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Skip this photo" }));
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("aborts from the top bar", () => {
    const { props } = renderRound();
    fireEvent.click(screen.getByTitle("Quit to menu"));
    expect(props.onAbort).toHaveBeenCalledTimes(1);
  });
});
