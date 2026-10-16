/** @jest-environment jsdom */
import { finishStalledSlideshowReveal, scheduleSlideshowFrame } from "./slideshowFrame";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.restoreAllMocks());
afterEach(() => jest.useRealTimers());

it("continues a visible slideshow when the browser stops delivering animation frames", () => {
  jest.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  const reveal = jest.fn();
  scheduleSlideshowFrame(reveal);
  jest.advanceTimersByTime(100);
  expect(reveal).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1000);
  expect(reveal).toHaveBeenCalledTimes(1);
});

it("does not run the fallback while hidden and can be cancelled", () => {
  jest.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const reveal = jest.fn();
  const cancel = scheduleSlideshowFrame(reveal);
  jest.advanceTimersByTime(1000);
  expect(reveal).not.toHaveBeenCalled();
  cancel();
  jest.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  jest.advanceTimersByTime(1000);
  expect(reveal).not.toHaveBeenCalled();
});

it("runs only once when animation frames and the fallback both become available", () => {
  let frame!: FrameRequestCallback;
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  const reveal = jest.fn();
  scheduleSlideshowFrame(reveal);
  frame(16);
  jest.advanceTimersByTime(1000);
  expect(reveal).toHaveBeenCalledTimes(1);
});

it("finishes an unstarted opacity transition only after its full duration and grace period", () => {
  const finish = jest.fn();
  const element = {
    getAnimations: () => [
      {
        transitionProperty: "opacity",
        pending: true,
        currentTime: 0,
        effect: { getComputedTiming: () => ({ endTime: 300 }) },
        finish,
      },
    ],
  } as unknown as Element;
  finishStalledSlideshowReveal(element, 399);
  expect(finish).not.toHaveBeenCalled();
  finishStalledSlideshowReveal(element, 400);
  expect(finish).toHaveBeenCalledTimes(1);
});

it("leaves progressing transitions and other animations alone", () => {
  const finish = jest.fn();
  const element = {
    getAnimations: () => [
      { transitionProperty: "opacity", pending: false, currentTime: 10, finish },
      { transitionProperty: "transform", pending: true, currentTime: 0, finish },
    ],
  } as unknown as Element;
  finishStalledSlideshowReveal(element, 1000);
  expect(finish).not.toHaveBeenCalled();
});
