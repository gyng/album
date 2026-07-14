/**
 * @jest-environment jsdom
 */

import { fireConfetti } from "./confetti";

const makeContext = () =>
  ({
    arc: jest.fn(),
    beginPath: jest.fn(),
    clearRect: jest.fn(),
    fill: jest.fn(),
    fillRect: jest.fn(),
    restore: jest.fn(),
    rotate: jest.fn(),
    save: jest.fn(),
    translate: jest.fn(),
    globalAlpha: 1,
    fillStyle: "",
  }) as unknown as CanvasRenderingContext2D;

describe("fireConfetti", () => {
  let context: CanvasRenderingContext2D;
  let frameCallbacks: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  const runNextFrame = () => {
    const next = frameCallbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!next) return false;
    frameCallbacks.delete(next[0]);
    next[1](0);
    return true;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    context = makeContext();
    frameCallbacks = new Map();
    nextFrameId = 1;

    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrameId++;
      frameCallbacks.set(id, callback);
      return id;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frameCallbacks.delete(id);
    });
    jest.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    document.querySelectorAll("canvas").forEach((canvas) => canvas.remove());
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("does nothing when reduced motion is requested", () => {
    jest.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);

    fireConfetti();

    expect(document.querySelector("canvas")).toBeNull();
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });

  it("removes the canvas when a drawing context is unavailable", () => {
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    fireConfetti();

    expect(document.querySelector("canvas")).toBeNull();
  });

  it("draws both particle shapes and self-cleans after the burst", () => {
    let randomCall = 0;
    jest.spyOn(Math, "random").mockImplementation(() => {
      const particleField = randomCall % 8;
      const particleIndex = Math.floor(randomCall / 8);
      randomCall += 1;
      return particleField === 7 && particleIndex % 2 === 1 ? 0.9 : 0.1;
    });

    fireConfetti({ x: 120, y: 240 });

    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveProperty("width", 1_200);
    expect(canvas).toHaveProperty("height", 800);

    let frameCount = 0;
    while (runNextFrame() && frameCount < 200) frameCount += 1;

    expect(frameCount).toBeGreaterThan(1);
    expect(context.fillRect).toHaveBeenCalled();
    expect(context.arc).toHaveBeenCalled();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("uses a centred origin and the safety timeout cancels an unfinished burst", () => {
    const cancelAnimationFrameSpy = jest.spyOn(window, "cancelAnimationFrame");

    fireConfetti();
    expect(document.querySelector("canvas")).not.toBeNull();
    expect(runNextFrame()).toBe(true);

    jest.advanceTimersByTime(4_000);

    expect(cancelAnimationFrameSpy).toHaveBeenCalled();
    expect(document.querySelector("canvas")).toBeNull();
  });
});
