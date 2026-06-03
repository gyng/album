/**
 * @jest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { useSlideshowCadence } from "./useSlideshowCadence";

const baseInput = {
  timeDelay: 60000,
  alignCadence: false,
  // Keep the per-second tick interval off so the only timer in play is the
  // advance timeout — the behaviour under test.
  controlsVisible: false,
  showClock: false,
  hasCurrentPhoto: true,
};

describe("useSlideshowCadence", () => {
  beforeEach(() => {
    // Fake timers mock Date + setTimeout so the advance deadline is
    // deterministic and we never wait on real wall-clock time.
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("fires onAdvance once the slide's time is up", () => {
    const onAdvance = jest.fn();
    renderHook(() => useSlideshowCadence({ ...baseInput, onAdvance }));

    expect(onAdvance).not.toHaveBeenCalled();
    // Advance well past the 60s cadence (and any wall-clock boundary).
    act(() => {
      jest.advanceTimersByTime(180000);
    });
    expect(onAdvance).toHaveBeenCalled();
  });

  it("does not fire onAdvance before there is a current photo", () => {
    const onAdvance = jest.fn();
    renderHook(() =>
      useSlideshowCadence({ ...baseInput, hasCurrentPhoto: false, onAdvance }),
    );
    act(() => {
      jest.advanceTimersByTime(180000);
    });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("pausing stops the advance timer", () => {
    const onAdvance = jest.fn();
    const { result } = renderHook(() =>
      useSlideshowCadence({ ...baseInput, onAdvance }),
    );

    act(() => {
      result.current.togglePaused();
    });
    expect(result.current.isPaused).toBe(true);

    act(() => {
      jest.advanceTimersByTime(300000);
    });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("togglePaused flips the paused state back and forth", () => {
    const { result } = renderHook(() =>
      useSlideshowCadence({ ...baseInput, onAdvance: jest.fn() }),
    );
    expect(result.current.isPaused).toBe(false);
    act(() => result.current.togglePaused());
    expect(result.current.isPaused).toBe(true);
    act(() => result.current.togglePaused());
    expect(result.current.isPaused).toBe(false);
  });
});
