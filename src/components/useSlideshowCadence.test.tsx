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
    renderHook(() => useSlideshowCadence({ ...baseInput, hasCurrentPhoto: false, onAdvance }));
    act(() => {
      jest.advanceTimersByTime(180000);
    });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("pausing stops the advance timer", () => {
    const onAdvance = jest.fn();
    const { result } = renderHook(() => useSlideshowCadence({ ...baseInput, onAdvance }));

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

  it("does not snap the first slide to a wall-clock boundary when alignCadence is off", () => {
    // 10:29:58 local with a 15-minute cadence: a boundary-snapped first slide
    // would end at 10:30:00 — a 2-second first slide. With alignment off it must
    // instead run the full raw delay.
    jest.setSystemTime(new Date(2026, 6, 3, 10, 29, 58));
    const onAdvance = jest.fn();
    renderHook(() =>
      useSlideshowCadence({
        ...baseInput,
        timeDelay: 900000,
        alignCadence: false,
        hasCurrentPhoto: true,
        onAdvance,
      }),
    );

    // 3s in — a boundary-snapped first slide would already have advanced.
    act(() => jest.advanceTimersByTime(3000));
    expect(onAdvance).not.toHaveBeenCalled();

    // The full raw 15-minute delay is honoured instead.
    act(() => jest.advanceTimersByTime(900000));
    expect(onAdvance).toHaveBeenCalled();
  });

  it("snaps the first slide to the wall-clock boundary when alignCadence is on", () => {
    jest.setSystemTime(new Date(2026, 6, 3, 10, 29, 58));
    const onAdvance = jest.fn();
    renderHook(() =>
      useSlideshowCadence({
        ...baseInput,
        timeDelay: 900000,
        alignCadence: true,
        hasCurrentPhoto: true,
        onAdvance,
      }),
    );

    // The first slide ends at the next boundary (~2s away), not 15 minutes on.
    act(() => jest.advanceTimersByTime(3000));
    expect(onAdvance).toHaveBeenCalled();
  });

  it("schedules later slides on an aligned cadence when requested", () => {
    jest.setSystemTime(new Date(2026, 6, 3, 10, 29, 58));
    const onAdvance = jest.fn();
    const { result } = renderHook(() =>
      useSlideshowCadence({ ...baseInput, timeDelay: 900000, alignCadence: true, onAdvance }),
    );

    act(() => result.current.scheduleNextChange());
    act(() => jest.advanceTimersByTime(3000));
    expect(onAdvance).toHaveBeenCalled();
  });

  it("updates the visible countdown and preserves it across pause, align, and resume", () => {
    jest.setSystemTime(new Date(2026, 6, 3, 10, 29, 0));
    const { result, unmount } = renderHook(() =>
      useSlideshowCadence({
        ...baseInput,
        controlsVisible: true,
        onAdvance: jest.fn(),
      }),
    );

    expect(result.current.time).toBeInstanceOf(Date);
    expect(result.current.secondsLeft).toBeGreaterThan(0);
    act(() => jest.advanceTimersByTime(1000));
    expect(result.current.secondsLeft).toBeLessThanOrEqual(59);

    act(() => result.current.togglePaused());
    const pausedSeconds = result.current.secondsLeft;
    act(() => result.current.alignNextChangeToCadence());
    act(() => jest.advanceTimersByTime(1000));
    expect(result.current.secondsLeft).toBe(pausedSeconds);

    act(() => result.current.togglePaused());
    expect(result.current.isPaused).toBe(false);
    unmount();
  });
});
