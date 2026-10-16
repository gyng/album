/** WebKit can stop delivering frames to an iframe during its initial reveal.
 * Keep decoded slides moving, but never use the timer to present while hidden. */
export const scheduleSlideshowFrame = (callback: () => void): (() => void) => {
  let active = true;
  let timer = 0;
  const run = () => {
    if (!active) return;
    active = false;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    callback();
  };
  const fallback = () => {
    if (document.visibilityState !== "hidden") run();
    else timer = window.setTimeout(fallback, 100);
  };
  const frame = window.requestAnimationFrame(run);
  timer = window.setTimeout(fallback, 100);
  return () => {
    active = false;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
};

/** Finish only a fade that WebKit has not started, after it should have ended.
 * Decoding and the layer's revealed state are checked by the caller first. */
export const finishStalledSlideshowReveal = (element: Element, elapsedMs: number): void => {
  if (document.visibilityState === "hidden") return;
  for (const animation of element.getAnimations?.() ?? []) {
    if (
      !("transitionProperty" in animation) ||
      animation.transitionProperty !== "opacity" ||
      !animation.pending ||
      (animation.currentTime !== null && animation.currentTime !== 0)
    )
      continue;
    const endTime = animation.effect?.getComputedTiming().endTime;
    if (typeof endTime === "number" && Number.isFinite(endTime) && elapsedMs >= endTime + 100)
      animation.finish();
  }
};
