import {
  DEFAULT_GESTURE_THRESHOLDS,
  resolvePointerMove,
  resolvePointerUpAction,
} from "./slideshowGesture";

// Defaults: swipeCommit 48 / swipeHint 24 / pullCommit 72 / pullHint 24.
const T = DEFAULT_GESTURE_THRESHOLDS;

describe("resolvePointerMove", () => {
  const move = (over: Partial<Parameters<typeof resolvePointerMove>[0]>) =>
    resolvePointerMove({
      deltaX: 0,
      deltaY: 0,
      controlsWereVisible: false,
      ...over,
    });

  it("stays idle below both hint thresholds", () => {
    expect(move({ deltaX: 10, deltaY: 10 })).toEqual({
      kind: "update",
      hint: null,
      pullProgress: 0,
      swipeProgress: 0,
      armed: false,
    });
  });

  it("commits horizontal-next on a leftward swipe and maps progress from the hint", () => {
    const r = move({ deltaX: -30, deltaY: 0 });
    expect(r).toMatchObject({
      kind: "update",
      committedHorizontal: "next",
      hint: "next",
      pullProgress: 0,
      armed: false,
    });
    // (30 - 24) / (48 - 24) = 0.25
    expect(r.kind === "update" && r.swipeProgress).toBeCloseTo(0.25);
  });

  it("arms at the horizontal commit distance", () => {
    const r = move({ deltaX: -48 });
    expect(r).toMatchObject({ committedHorizontal: "next", armed: true });
    expect(r.kind === "update" && r.swipeProgress).toBe(1);
  });

  it("commits horizontal-previous on a rightward swipe", () => {
    expect(move({ deltaX: 30 })).toMatchObject({
      committedHorizontal: "previous",
      hint: "previous",
    });
  });

  it("drops to idle when reversing past the committed horizontal direction", () => {
    // committed next, now dragged right past the hint → cancel visual
    expect(move({ deltaX: 30, committedHorizontal: "next" })).toEqual({
      kind: "update",
      hint: null,
      pullProgress: 0,
      swipeProgress: 0,
      armed: false,
    });
  });

  it("commits vertical-up (remix hint) on an upward pull", () => {
    const r = move({ deltaY: -30 });
    expect(r).toMatchObject({
      committedVertical: "up",
      hint: "remix",
      swipeProgress: 0,
    });
    // (30 - 24) / (72 - 24) = 0.125
    expect(r.kind === "update" && r.pullProgress).toBeCloseTo(0.125);
  });

  it("commits vertical-down (controls hint) when controls are hidden", () => {
    expect(move({ deltaY: 30, controlsWereVisible: false })).toMatchObject({
      committedVertical: "down",
      hint: "controls",
    });
  });

  it("ignores a downward pull when controls are already visible (no action)", () => {
    expect(move({ deltaY: 30, controlsWereVisible: true })).toEqual({
      kind: "update",
      hint: null,
      pullProgress: 0,
      swipeProgress: 0,
      armed: false,
    });
  });

  it("ignores vertical drift once horizontal is committed", () => {
    expect(
      move({ deltaY: -40, deltaX: 0, committedHorizontal: "next" }),
    ).toEqual({ kind: "ignore" });
  });

  it("ignores horizontal drift once vertical is committed", () => {
    expect(
      move({ deltaX: -40, deltaY: 0, committedVertical: "up" }),
    ).toEqual({ kind: "ignore" });
  });

  it("arms at the vertical commit distance", () => {
    const r = move({ deltaY: -72 });
    expect(r).toMatchObject({ committedVertical: "up", armed: true });
    expect(r.kind === "update" && r.pullProgress).toBe(1);
  });
});

describe("resolvePointerUpAction", () => {
  const tapAt = (clientX: number, canGoPrevious: boolean) => ({
    clientX,
    getBounds: () => ({ left: 0, width: 1000 }),
    canGoPrevious,
  });

  const up = (over: Partial<Parameters<typeof resolvePointerUpAction>[0]>) =>
    resolvePointerUpAction({
      deltaX: 0,
      deltaY: 0,
      isTouchLike: true,
      controlsWereVisible: false,
      tap: tapAt(500, true),
      ...over,
    });

  it("advances on a committed leftward swipe past commit", () => {
    expect(up({ deltaX: -60, committedHorizontal: "next" })).toEqual({
      action: "next",
      suppressClick: true,
    });
  });

  it("goes previous on a committed rightward swipe past commit", () => {
    expect(up({ deltaX: 60, committedHorizontal: "previous" })).toEqual({
      action: "previous",
      suppressClick: true,
    });
  });

  it("cancels (no action, no suppression) when released opposite to the committed horizontal", () => {
    // committed next but ended far right past commit
    expect(up({ deltaX: 60, committedHorizontal: "next" })).toEqual({
      action: "none",
      suppressClick: false,
    });
  });

  it("treats a past-commit MOUSE drag as horizontal navigation (un-gated by pointer type)", () => {
    expect(up({ deltaX: -60, isTouchLike: false })).toEqual({
      action: "next",
      suppressClick: true,
    });
  });

  it("remixes on an upward pull from a controls-hidden slide", () => {
    expect(up({ deltaY: -60, controlsWereVisible: false })).toEqual({
      action: "remix",
      suppressClick: true,
    });
  });

  it("hides controls on an upward pull when controls were visible", () => {
    expect(up({ deltaY: -60, controlsWereVisible: true })).toEqual({
      action: "hide-controls",
      suppressClick: true,
    });
  });

  it("shows controls on a downward pull from a controls-hidden slide", () => {
    expect(up({ deltaY: 60, controlsWereVisible: false })).toEqual({
      action: "show-controls",
      suppressClick: true,
    });
  });

  it("does nothing (no suppression) on a downward pull when controls were visible", () => {
    expect(up({ deltaY: 60, controlsWereVisible: true })).toEqual({
      action: "none",
      suppressClick: false,
    });
  });

  it("cancels a reversed vertical gesture without acting or suppressing", () => {
    expect(up({ deltaY: 60, committedVertical: "up" })).toEqual({
      action: "none",
      suppressClick: false,
    });
  });

  it("never treats an upward MOUSE drag as a vertical action", () => {
    // isTouchLike false → no vertical; no horizontal commit either → nothing.
    expect(up({ deltaY: -60, isTouchLike: false })).toEqual({
      action: "none",
      suppressClick: false,
    });
  });

  it("taps in the left zone go to previous when allowed", () => {
    expect(up({ deltaX: 2, deltaY: 2, tap: tapAt(100, true) })).toEqual({
      action: "previous",
      suppressClick: true,
    });
  });

  it("taps in the left zone go to next when previous isn't available", () => {
    expect(up({ deltaX: 2, deltaY: 2, tap: tapAt(100, false) })).toEqual({
      action: "next",
      suppressClick: true,
    });
  });

  it("taps in the right zone go to next", () => {
    expect(up({ deltaX: 2, deltaY: 2, tap: tapAt(900, true) })).toEqual({
      action: "next",
      suppressClick: true,
    });
  });

  it("a committed axis released SHORT of the commit distance does not act (touch: still suppresses)", () => {
    // 30px < 48px commit: the committed-axis ternary gates on >= commit, so
    // this falls through to the touch branch — no nav, but the synthetic click
    // is still swallowed. Guards against a `committed || dist>=swipe` regression
    // that would fire the action on a cancelled short drag.
    expect(up({ deltaY: -30, committedVertical: "up" })).toEqual({
      action: "none",
      suppressClick: true,
    });
    expect(up({ deltaX: -30, committedHorizontal: "next" })).toEqual({
      action: "none",
      suppressClick: true,
    });
  });

  it("a committed MOUSE axis released short of commit does nothing and does not suppress", () => {
    expect(
      up({ deltaX: -30, committedHorizontal: "next", isTouchLike: false }),
    ).toEqual({ action: "none", suppressClick: false });
  });

  it("suppresses the synthetic click on a mid-distance touch jitter without navigating", () => {
    // 30px: past the 12px tap drift, below the 48px commit → no action, but
    // the click must still be swallowed so the jitter doesn't advance.
    expect(up({ deltaX: 30, deltaY: 0 })).toEqual({
      action: "none",
      suppressClick: true,
    });
  });

  it("does nothing and does not suppress for a sub-threshold MOUSE move", () => {
    expect(up({ deltaX: 5, deltaY: 5, isTouchLike: false })).toEqual({
      action: "none",
      suppressClick: false,
    });
  });
});

describe("DEFAULT_GESTURE_THRESHOLDS", () => {
  it("matches the page's documented commit/hint distances", () => {
    expect(T).toEqual({
      swipeCommitPx: 48,
      swipeHintPx: 24,
      pullCommitPx: 72,
      pullHintPx: 24,
    });
  });
});
