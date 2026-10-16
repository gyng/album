/** @jest-environment jsdom */
import { scheduleSlideshowFrame } from "./slideshowFrame";

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
