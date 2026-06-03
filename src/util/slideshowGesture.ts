import { getSlideshowTouchTapAction } from "./slideshowTouch";

// Pure decision cores for the slideshow's pointer-gesture machine. The
// imperative shell (pointer capture, setState, haptics, refs, and the
// synthetic-click suppression ref) stays in the page; these encode the
// branching so the densest part of the gesture logic is unit-tested.

export type GestureHint = "next" | "previous" | "controls" | "remix";
export type HorizontalDirection = "next" | "previous";
export type VerticalDirection = "down" | "up";

export type GestureThresholds = {
  swipeCommitPx: number;
  swipeHintPx: number;
  pullCommitPx: number;
  pullHintPx: number;
};

export const DEFAULT_GESTURE_THRESHOLDS: GestureThresholds = {
  swipeCommitPx: 48,
  // Hint fades in from half the commit distance for swipes, a third for pulls.
  swipeHintPx: 24,
  pullCommitPx: 72,
  pullHintPx: 24,
};

// Below this drift a touch release counts as a tap (tap-zone navigation)
// rather than a swipe.
const TAP_MAX_DRIFT_PX = 12;

const progressFromDistance = (
  distance: number,
  hintPx: number,
  commitPx: number,
): number => Math.max(0, Math.min(1, (distance - hintPx) / (commitPx - hintPx)));

// What the move handler should do with the current pointer delta. "ignore"
// means leave all visuals untouched (the other axis is already committed); an
// "update" carries the fresh visual state plus any newly-committed axis
// direction the caller should persist on the gesture.
export type PointerMoveResolution =
  | { kind: "ignore" }
  | {
      kind: "update";
      committedHorizontal?: HorizontalDirection;
      committedVertical?: VerticalDirection;
      hint: GestureHint | null;
      pullProgress: number;
      swipeProgress: number;
      armed: boolean;
    };

const IDLE: PointerMoveResolution = {
  kind: "update",
  hint: null,
  pullProgress: 0,
  swipeProgress: 0,
  armed: false,
};

export const resolvePointerMove = (
  input: {
    deltaX: number;
    deltaY: number;
    committedHorizontal?: HorizontalDirection;
    committedVertical?: VerticalDirection;
    controlsWereVisible: boolean;
  },
  thresholds: GestureThresholds = DEFAULT_GESTURE_THRESHOLDS,
): PointerMoveResolution => {
  const horizontalDistance = Math.abs(input.deltaX);
  const verticalDistance = Math.abs(input.deltaY);

  const isVertical =
    verticalDistance >= thresholds.pullHintPx &&
    verticalDistance > horizontalDistance;
  const isHorizontal =
    horizontalDistance >= thresholds.swipeHintPx &&
    horizontalDistance > verticalDistance;

  if (isVertical) {
    // Once horizontal is committed, ignore vertical drift (and vice versa).
    if (input.committedHorizontal) {
      return { kind: "ignore" };
    }

    const direction: VerticalDirection = input.deltaY > 0 ? "down" : "up";

    // A downward pull from a controls-visible state has no action.
    if (direction === "down" && input.controlsWereVisible) {
      return IDLE;
    }

    // Reversed past the committed direction → cancel the visual.
    if (input.committedVertical && input.committedVertical !== direction) {
      return IDLE;
    }

    const pullProgress = progressFromDistance(
      verticalDistance,
      thresholds.pullHintPx,
      thresholds.pullCommitPx,
    );
    return {
      kind: "update",
      committedVertical: input.committedVertical ?? direction,
      hint: direction === "down" ? "controls" : "remix",
      pullProgress,
      swipeProgress: 0,
      armed: pullProgress >= 1,
    };
  }

  if (isHorizontal) {
    if (input.committedVertical) {
      return { kind: "ignore" };
    }

    const direction: HorizontalDirection =
      input.deltaX < 0 ? "next" : "previous";

    if (input.committedHorizontal && input.committedHorizontal !== direction) {
      return IDLE;
    }

    const committedHorizontal = input.committedHorizontal ?? direction;
    const swipeProgress = progressFromDistance(
      horizontalDistance,
      thresholds.swipeHintPx,
      thresholds.swipeCommitPx,
    );
    return {
      kind: "update",
      committedHorizontal,
      hint: committedHorizontal,
      pullProgress: 0,
      swipeProgress,
      armed: swipeProgress >= 1,
    };
  }

  return IDLE;
};

export type GestureAction =
  | "next"
  | "previous"
  | "show-controls"
  | "hide-controls"
  | "remix"
  | "none";

// What the release handler should do, plus whether the synthetic click the
// browser fires after a touch pointerup must be swallowed. The cancel branches
// deliberately return suppressClick:false to preserve the original behaviour.
export const resolvePointerUpAction = (
  input: {
    deltaX: number;
    deltaY: number;
    isTouchLike: boolean;
    committedHorizontal?: HorizontalDirection;
    committedVertical?: VerticalDirection;
    controlsWereVisible: boolean;
    tap: {
      clientX: number;
      // Lazy so the layout read (getBoundingClientRect → reflow) only happens
      // on the tap path, not on every swipe/pull/cancel release.
      getBounds: () => { left: number; width: number };
      canGoPrevious: boolean;
    };
  },
  thresholds: GestureThresholds = DEFAULT_GESTURE_THRESHOLDS,
): { action: GestureAction; suppressClick: boolean } => {
  const horizontalDistance = Math.abs(input.deltaX);
  const verticalDistance = Math.abs(input.deltaY);
  const horizontalCommitted = !!input.committedHorizontal;
  const verticalCommitted = !!input.committedVertical;
  const swipe = thresholds.swipeCommitPx;

  // Horizontal commits are un-gated by pointer type: a mouse drag past the
  // threshold still navigates. Vertical commits are touch-first and gated on
  // touch/pen so a mouse drag-up never silently triggers a remix.
  const treatAsHorizontal = horizontalCommitted
    ? horizontalDistance >= swipe
    : !verticalCommitted &&
      horizontalDistance >= swipe &&
      horizontalDistance > verticalDistance;
  const treatAsVertical =
    input.isTouchLike &&
    (verticalCommitted
      ? verticalDistance >= swipe
      : !horizontalCommitted &&
        verticalDistance >= swipe &&
        verticalDistance > horizontalDistance);

  if (treatAsHorizontal) {
    const finalDirection: HorizontalDirection =
      input.deltaX < 0 ? "next" : "previous";
    // Dragged back past the start in the opposite direction → cancelled.
    if (input.committedHorizontal && finalDirection !== input.committedHorizontal) {
      return { action: "none", suppressClick: false };
    }
    return {
      action: input.committedHorizontal ?? finalDirection,
      suppressClick: true,
    };
  }

  if (treatAsVertical) {
    const finalDirection: VerticalDirection = input.deltaY > 0 ? "down" : "up";
    if (input.committedVertical && finalDirection !== input.committedVertical) {
      return { action: "none", suppressClick: false };
    }

    const effective = input.committedVertical ?? finalDirection;
    if (effective === "down") {
      if (!input.controlsWereVisible) {
        return { action: "show-controls", suppressClick: true };
      }
      return { action: "none", suppressClick: false };
    }

    // Upward pull: hide visible controls, otherwise force a remix.
    if (input.controlsWereVisible) {
      return { action: "hide-controls", suppressClick: true };
    }
    return { action: "remix", suppressClick: true };
  }

  if (input.isTouchLike) {
    // The browser synthesises a click after every touch pointerup; swallow it
    // for any touch release that reached here so a jitter or cancelled gesture
    // can't fall through to the image's onClick and silently advance.
    if (
      horizontalDistance < TAP_MAX_DRIFT_PX &&
      verticalDistance < TAP_MAX_DRIFT_PX
    ) {
      const tapAction = getSlideshowTouchTapAction({
        clientX: input.tap.clientX,
        bounds: input.tap.getBounds(),
        canGoPrevious: input.tap.canGoPrevious,
      });
      return {
        action: tapAction === "previous" ? "previous" : "next",
        suppressClick: true,
      };
    }
    return { action: "none", suppressClick: true };
  }

  return { action: "none", suppressClick: false };
};
