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
