/**
 * @jest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { useControlsAutoHide } from "./useControlsAutoHide";

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

describe("useControlsAutoHide", () => {
  beforeEach(() => {
    // Fake timers keep the hide deadline and desktop reveal suppression deterministic.
    jest.useFakeTimers();
    mockMatchMedia(false); // desktop / fine pointer by default
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("starts with controls visible and a full progress ring", () => {
    const { result } = renderHook(() => useControlsAutoHide());
    expect(result.current.controlsVisible).toBe(true);
    expect(result.current.controlsHideProgress).toBe(1);
    expect(result.current.isCoarsePointer).toBe(false);

    act(() => result.current.extendControlsHideDeadline());
    expect(result.current.controlsHideProgress).toBe(1);
  });

  it("reflects a coarse pointer from matchMedia", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useControlsAutoHide());
    expect(result.current.isCoarsePointer).toBe(true);
  });

  it("dismissControls hides without suppressing a subsequent desktop reveal", () => {
    const { result } = renderHook(() => useControlsAutoHide());
    act(() => result.current.dismissControls());
    expect(result.current.controlsVisible).toBe(false);
    // No suppression window → the top-edge reveal works immediately.
    act(() => result.current.showControlsForDesktop());
    expect(result.current.controlsVisible).toBe(true);
  });

  it("hideDesktopControls suppresses an immediate re-open, then allows it after 700ms", () => {
    const { result } = renderHook(() => useControlsAutoHide());
    act(() => result.current.hideDesktopControls());
    expect(result.current.controlsVisible).toBe(false);

    // Within the 700ms suppression window the cursor-on-trigger reveal is ignored.
    act(() => result.current.showControlsForDesktop());
    expect(result.current.controlsVisible).toBe(false);

    // After the window elapses, the reveal works.
    act(() => {
      jest.advanceTimersByTime(701);
    });
    act(() => result.current.showControlsForDesktop());
    expect(result.current.controlsVisible).toBe(true);
  });

  it("showControlsForDesktop is a no-op on a coarse pointer", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useControlsAutoHide());
    act(() => result.current.dismissControls());
    expect(result.current.controlsVisible).toBe(false);
    act(() => result.current.showControlsForDesktop());
    // Coarse pointers drive visibility via touch gestures, not mouse-to-top.
    expect(result.current.controlsVisible).toBe(false);

    act(() => result.current.extendControlsHideDeadline());
    expect(result.current.controlsHideProgress).toBe(0);
  });

  it("counts down and hides desktop controls after the idle deadline", () => {
    const { result } = renderHook(() => useControlsAutoHide());

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(result.current.controlsHideProgress).toBeGreaterThan(0);
    expect(result.current.controlsHideProgress).toBeLessThan(1);

    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(result.current.controlsVisible).toBe(false);
    expect(result.current.controlsHideProgress).toBe(0);
  });

  it("hides touch controls after reload even when animation frames stop arriving", () => {
    mockMatchMedia(true);
    jest.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { result } = renderHook(() => useControlsAutoHide());
    act(() => {
      jest.advanceTimersByTime(31000);
    });
    expect(result.current.controlsVisible).toBe(false);
    expect(result.current.controlsHideProgress).toBe(0);
    jest.restoreAllMocks();
  });

  it("checks an expired touch deadline when the document resumes without timer delivery", () => {
    mockMatchMedia(true);
    jest.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { result } = renderHook(() => useControlsAutoHide());
    act(() => {
      jest.setSystemTime(Date.now() + 31000);
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(result.current.controlsVisible).toBe(false);
    expect(result.current.controlsHideProgress).toBe(0);
    jest.restoreAllMocks();
  });

  it("keeps the extended touch deadline when animation frames have stalled", () => {
    mockMatchMedia(true);
    jest.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { result } = renderHook(() => useControlsAutoHide());
    act(() => {
      jest.advanceTimersByTime(20000);
    });
    act(() => {
      result.current.extendControlsHideDeadline();
    });
    act(() => {
      jest.advanceTimersByTime(29000);
    });
    expect(result.current.controlsVisible).toBe(true);
    act(() => {
      jest.advanceTimersByTime(1100);
    });
    expect(result.current.controlsVisible).toBe(false);
    jest.restoreAllMocks();
  });

  it("pauses the countdown while the pointer is over the toolbar", () => {
    const { result } = renderHook(() => useControlsAutoHide());

    act(() => result.current.setIsPointerOverToolbar(true));
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(result.current.controlsVisible).toBe(true);
    expect(result.current.controlsHideProgress).toBe(1);
  });

  it("keeps counting down on a coarse pointer, which cannot leave the toolbar", () => {
    // iPadOS synthesises a mouse enter on the tap that presses a toolbar
    // button, and nothing sends the matching leave until a tap lands somewhere
    // else. Holding the controls open for that latch left the toolbar on screen
    // for the rest of the session after "Keep screen awake" was tapped.
    mockMatchMedia(true);
    const { result } = renderHook(() => useControlsAutoHide());

    act(() => result.current.setIsPointerOverToolbar(true));
    act(() => {
      jest.advanceTimersByTime(31000);
    });

    expect(result.current.controlsVisible).toBe(false);
  });

  it("extends the longer touch deadline after an interaction", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useControlsAutoHide());

    act(() => {
      jest.advanceTimersByTime(20000);
    });
    expect(result.current.controlsVisible).toBe(true);

    act(() => result.current.extendControlsHideDeadline());
    act(() => {
      jest.advanceTimersByTime(29000);
    });
    expect(result.current.controlsVisible).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1100);
    });
    expect(result.current.controlsVisible).toBe(false);
  });

  it("makes an already queued animation frame harmless after an explicit hide", () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestFrame = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callbacks.push(callback);
        return callbacks.length;
      });
    const cancelFrame = jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { result } = renderHook(() => useControlsAutoHide());
    expect(callbacks).toHaveLength(1);

    act(() => {
      result.current.hideDesktopControls();
      callbacks[0]!(0);
    });

    expect(result.current.controlsVisible).toBe(false);
    expect(result.current.controlsHideProgress).toBe(0);
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });
});
