import React, { useCallback, useEffect } from "react";

// Desktop controls auto-hide after a short idle; touch/coarse pointers get a
// much longer dwell since the user can't mouse-out to dismiss.
const CONTROLS_AUTO_HIDE_MS = 3000;
const TOUCH_CONTROLS_AUTO_HIDE_MS = 30000;

export type UseControlsAutoHide = {
  controlsVisible: boolean;
  setControlsVisible: React.Dispatch<React.SetStateAction<boolean>>;
  controlsHideProgress: number;
  isCoarsePointer: boolean;
  setIsPointerOverToolbar: React.Dispatch<React.SetStateAction<boolean>>;
  // Bump the auto-hide deadline forward (touch only) so interactions keep the
  // toolbar awake; desktop gets this via the pointer-over-toolbar branch.
  extendControlsHideDeadline: () => void;
  // Desktop mouse-to-top reveal (no-op on coarse pointers, and during the
  // post-Hide suppression window).
  showControlsForDesktop: () => void;
  // Desktop "Hide" button: hide and suppress an immediate re-open from the
  // cursor still sitting over the top-edge trigger.
  hideDesktopControls: () => void;
  // Touch drag-up dismiss: hide WITHOUT the desktop re-show suppression.
  dismissControls: () => void;
};

// Owns the slideshow controls' visibility lifecycle: coarse-pointer detection,
// an independent hide deadline, the animated progress ring, and
// the desktop show/hide + post-Hide suppression.
export const useControlsAutoHide = (): UseControlsAutoHide => {
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [controlsHideProgress, setControlsHideProgressState] = React.useState(1);
  // Every touch move extends the deadline and re-sets the progress to 1. React
  // renders once more for a repeated value just after an update, so during a
  // drag the moves after each hint or arming change re-rendered the whole
  // slideshow for nothing; an unchanged value is skipped here instead.
  const controlsHideProgressRef = React.useRef(1);
  const setControlsHideProgress = useCallback((progress: number) => {
    if (controlsHideProgressRef.current === progress) return;
    controlsHideProgressRef.current = progress;
    setControlsHideProgressState(progress);
  }, []);
  const [isCoarsePointer, setIsCoarsePointer] = React.useState(false);
  const [isPointerOverToolbar, setIsPointerOverToolbar] = React.useState(false);
  const controlsHideDeadlineRef = React.useRef<number | null>(null);
  const suppressDesktopShowUntilRef = React.useRef(0);

  const extendControlsHideDeadline = useCallback(() => {
    if (!isCoarsePointer || !controlsVisible) {
      return;
    }
    controlsHideDeadlineRef.current = Date.now() + TOUCH_CONTROLS_AUTO_HIDE_MS;
    setControlsHideProgress(1);
  }, [controlsVisible, isCoarsePointer, setControlsHideProgress]);

  useEffect(() => {
    const coarsePointerQuery = window.matchMedia("(hover: none), (pointer: coarse)");
    const syncCoarsePointer = () => {
      setIsCoarsePointer(coarsePointerQuery.matches);
    };

    // Subscribe to the media query and seed the initial value (client-only).
    syncCoarsePointer();
    coarsePointerQuery.addEventListener("change", syncCoarsePointer);
    return () => {
      coarsePointerQuery.removeEventListener("change", syncCoarsePointer);
    };
  }, []);

  useEffect(() => {
    if (!controlsVisible) {
      controlsHideDeadlineRef.current = null;
      // Reset the progress ring to empty when controls are hidden — an
      // external-state sync, not a derived-state cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setControlsHideProgress(0);
      return;
    }

    // A cursor resting on the toolbar is someone reading it, so the countdown
    // waits. A finger cannot rest anywhere: iPadOS synthesises a mouse enter on
    // the tap that presses a toolbar button and sends no leave until a tap
    // lands elsewhere, so honouring the latch there stopped the clock for the
    // rest of the session — tapping "Keep screen awake" left the controls up.
    // Touch keeps the toolbar awake by extending the deadline instead.
    if (isPointerOverToolbar && !isCoarsePointer) {
      controlsHideDeadlineRef.current = null;
      setControlsHideProgress(1);
      return;
    }

    // Touch/coarse-pointer gets a much longer dwell since the user can't
    // mouse-out to dismiss. The ring still renders to make the impending
    // auto-hide discoverable.
    const autoHideMs = isCoarsePointer ? TOUCH_CONTROLS_AUTO_HIDE_MS : CONTROLS_AUTO_HIDE_MS;
    const deadline = Date.now() + autoHideMs;
    controlsHideDeadlineRef.current = deadline;
    setControlsHideProgress(1);

    let frameId = 0;
    let hideTimerId = 0;
    let active = true;

    const hideExpiredControls = () => {
      controlsHideDeadlineRef.current = null;
      setControlsHideProgress(0);
      setControlsVisible(false);
    };

    // A reloaded or suspended iframe may stop receiving animation frames.
    // Painting the ring must never be what makes the controls disappear.
    const checkDeadline = () => {
      if (!active) return;
      const currentDeadline = controlsHideDeadlineRef.current;
      if (currentDeadline === null) return;
      const remaining = Math.max(0, currentDeadline - Date.now());
      window.clearTimeout(hideTimerId);
      if (remaining === 0) {
        hideExpiredControls();
        return;
      }
      setControlsHideProgress(remaining / autoHideMs);
      hideTimerId = window.setTimeout(checkDeadline, remaining);
    };

    const checkOnResume = () => {
      if (document.visibilityState !== "hidden") checkDeadline();
    };

    const tick = () => {
      if (!active) return;
      const currentDeadline = controlsHideDeadlineRef.current;
      if (!currentDeadline) {
        setControlsHideProgress(0);
        return;
      }

      const remaining = Math.max(0, currentDeadline - Date.now());
      const progress = remaining / autoHideMs;
      setControlsHideProgress(progress);

      if (remaining <= 0) {
        hideExpiredControls();
        return;
      }
      frameId = window.requestAnimationFrame(tick);
    };

    checkDeadline();
    window.addEventListener("pageshow", checkOnResume);
    window.addEventListener("focus", checkOnResume);
    document.addEventListener("visibilitychange", checkOnResume);
    frameId = window.requestAnimationFrame(tick);

    return () => {
      active = false;
      window.clearTimeout(hideTimerId);
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("pageshow", checkOnResume);
      window.removeEventListener("focus", checkOnResume);
      document.removeEventListener("visibilitychange", checkOnResume);
    };
  }, [controlsVisible, isCoarsePointer, isPointerOverToolbar, setControlsHideProgress]);

  const showControlsForDesktop = useCallback(() => {
    if (isCoarsePointer) {
      return;
    }
    if (Date.now() < suppressDesktopShowUntilRef.current) {
      return;
    }
    setControlsVisible(true);
  }, [isCoarsePointer]);

  const hideDesktopControls = useCallback(() => {
    controlsHideDeadlineRef.current = null;
    suppressDesktopShowUntilRef.current = Date.now() + 700;
    setControlsVisible(false);
  }, []);

  const dismissControls = useCallback(() => {
    controlsHideDeadlineRef.current = null;
    setControlsVisible(false);
  }, []);

  return {
    controlsVisible,
    setControlsVisible,
    controlsHideProgress,
    isCoarsePointer,
    setIsPointerOverToolbar,
    extendControlsHideDeadline,
    showControlsForDesktop,
    hideDesktopControls,
    dismissControls,
  };
};
