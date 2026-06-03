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
    // Fake timers mock Date.now() so the 700ms suppression window is
    // controllable; the rAF auto-hide deadline (3s) is never advanced to in
    // these tests, so controls don't spontaneously hide mid-assertion.
    jest.useFakeTimers();
    mockMatchMedia(false); // desktop / fine pointer by default
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts with controls visible and a full progress ring", () => {
    const { result } = renderHook(() => useControlsAutoHide());
    expect(result.current.controlsVisible).toBe(true);
    expect(result.current.controlsHideProgress).toBe(1);
    expect(result.current.isCoarsePointer).toBe(false);
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
  });
});
