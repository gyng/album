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
// the requestAnimationFrame auto-hide countdown (with its progress ring), and
// the desktop show/hide + post-Hide suppression. Extracted verbatim from the
// slideshow page; consumers destructure to the same local names they used.
export const useControlsAutoHide = (): UseControlsAutoHide => {
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [controlsHideProgress, setControlsHideProgress] = React.useState(1);
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
  }, [controlsVisible, isCoarsePointer]);

  useEffect(() => {
    const coarsePointerQuery = window.matchMedia(
      "(hover: none), (pointer: coarse)",
    );
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

    if (isPointerOverToolbar) {
      controlsHideDeadlineRef.current = null;
      setControlsHideProgress(1);
      return;
    }

    // Touch/coarse-pointer gets a much longer dwell since the user can't
    // mouse-out to dismiss. The ring still renders to make the impending
    // auto-hide discoverable.
    const autoHideMs = isCoarsePointer
      ? TOUCH_CONTROLS_AUTO_HIDE_MS
      : CONTROLS_AUTO_HIDE_MS;
    const deadline = Date.now() + autoHideMs;
    controlsHideDeadlineRef.current = deadline;
    setControlsHideProgress(1);

    let frameId = 0;

    const tick = () => {
      const currentDeadline = controlsHideDeadlineRef.current;
      if (!currentDeadline) {
        setControlsHideProgress(0);
        return;
      }

      const remaining = Math.max(0, currentDeadline - Date.now());
      const progress = remaining / autoHideMs;
      setControlsHideProgress(progress);

      if (remaining <= 0) {
        controlsHideDeadlineRef.current = null;
        setControlsVisible(false);
        return;
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
  }, [controlsVisible, isCoarsePointer, isPointerOverToolbar]);

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
