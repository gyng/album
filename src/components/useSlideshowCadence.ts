import React, { useCallback, useEffect } from "react";
import { getNextAlignedSlideshowChange } from "../util/slideshowTiming";

export type UseSlideshowCadence = {
  secondsLeft: number;
  time: Date;
  isPaused: boolean;
  togglePaused: () => void;
  // Reschedule the next change to now + delay (honouring the alignment toggle).
  // Called on every new slide (forward advance + history navigation).
  scheduleNextChange: () => void;
  // Snap the next change to the cadence boundary right now (the Align button,
  // and the auto-align on first photo load).
  alignNextChangeToCadence: () => void;
};

// Owns the slideshow's advance cadence: the nextChangeAt timer that fires the
// advance, pause/resume (freezing and restoring the remaining time), the
// per-second countdown + clock tick, and the wall-clock alignment. The advance
// action is supplied via onAdvance — pass a stable wrapper over a ref to the
// latest goNext, since goNext is defined after this hook is called and changes
// identity. Extracted verbatim from the slideshow page.
export const useSlideshowCadence = (input: {
  timeDelay: number;
  alignCadence: boolean;
  controlsVisible: boolean;
  showClock: boolean;
  hasCurrentPhoto: boolean;
  onAdvance: () => void;
}): UseSlideshowCadence => {
  const {
    timeDelay,
    alignCadence,
    controlsVisible,
    showClock,
    hasCurrentPhoto,
    onAdvance,
  } = input;

  const [nextChangeAt, setNextChangeAt] = React.useState<Date>(new Date());
  const [secondsLeft, setSecondsLeft] = React.useState<number>(0);
  const [time, setTime] = React.useState<Date>(new Date());
  const [isPaused, setIsPaused] = React.useState(false);
  const pausedRemainingMsRef = React.useRef<number | null>(null);

  // Single source of truth for "when does the next slide change?". Honours the
  // alignCadence toggle: snap to the next wall-clock boundary or add the delay
  // raw.
  const computeNextChangeAt = useCallback(
    (now: Date = new Date()): Date => {
      if (alignCadence) {
        return getNextAlignedSlideshowChange({ now, delayMs: timeDelay });
      }
      return new Date(now.getTime() + timeDelay);
    },
    [alignCadence, timeDelay],
  );

  const scheduleNextChange = useCallback(() => {
    setNextChangeAt(computeNextChangeAt());
  }, [computeNextChangeAt]);

  const togglePaused = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  const alignNextChangeToCadence = useCallback(() => {
    const alignedNextChange = getNextAlignedSlideshowChange({
      now: new Date(),
      delayMs: timeDelay,
    });
    const remainingMs = Math.max(0, alignedNextChange.getTime() - Date.now());

    setNextChangeAt(alignedNextChange);
    setSecondsLeft(remainingMs / 1000);

    if (isPaused) {
      pausedRemainingMsRef.current = remainingMs;
    }
  }, [isPaused, timeDelay]);

  // Auto-align to the cadence boundary on first photo load.
  const hasAutoAlignedRef = React.useRef(false);
  useEffect(() => {
    if (!hasCurrentPhoto || hasAutoAlignedRef.current) {
      return;
    }
    hasAutoAlignedRef.current = true;
    alignNextChangeToCadence();
  }, [alignNextChangeToCadence, hasCurrentPhoto]);

  // The advance timer: fire onAdvance when the slide's time is up.
  useEffect(() => {
    if (isPaused || !hasCurrentPhoto) {
      return;
    }

    const delayUntilNext = Math.max(0, nextChangeAt.getTime() - Date.now());
    const id = window.setTimeout(() => {
      onAdvance();
    }, delayUntilNext);

    return () => window.clearTimeout(id);
  }, [hasCurrentPhoto, isPaused, nextChangeAt, onAdvance]);

  // Pause freezes the remaining time; resume restarts the countdown from it.
  useEffect(() => {
    if (isPaused) {
      const remaining = Math.max(0, nextChangeAt.getTime() - Date.now());
      pausedRemainingMsRef.current = remaining;
      setSecondsLeft(remaining / 1000);
      return;
    }

    if (pausedRemainingMsRef.current !== null) {
      const remaining = pausedRemainingMsRef.current;
      pausedRemainingMsRef.current = null;
      setNextChangeAt(new Date(Date.now() + remaining));
      setSecondsLeft(remaining / 1000);
    }
  }, [isPaused, nextChangeAt]);

  // Per-second tick for the countdown + clock. Only runs while something that
  // displays it is on screen (the toolbar countdown or the clock); advancement
  // is driven by the separate nextChangeAt timer, not this display tick.
  useEffect(() => {
    if (!controlsVisible && !showClock) {
      return;
    }

    const tick = () => {
      const pausedRemaining = pausedRemainingMsRef.current;
      setSecondsLeft(
        pausedRemaining !== null
          ? pausedRemaining / 1000
          : (nextChangeAt.getTime() - Date.now()) / 1000,
      );
      setTime(new Date());
    };
    // Update immediately so values are fresh the moment they become visible.
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [controlsVisible, nextChangeAt, showClock]);

  return {
    secondsLeft,
    time,
    isPaused,
    togglePaused,
    scheduleNextChange,
    alignNextChangeToCadence,
  };
};
