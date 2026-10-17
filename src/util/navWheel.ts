/** One line of a line-mode wheel (`deltaMode` 1), in pixels. */
const WHEEL_LINE_PX = 16;

type Wheel = { deltaX: number; deltaY: number; deltaMode: number };
type Strip = { scrollLeft: number; scrollWidth: number; clientWidth: number };

/**
 * How far a wheel turn should move a horizontal strip, or null to leave the
 * wheel to the browser.
 *
 * The nav is a sideways scroller with its scrollbar hidden, and a mouse wheel
 * only turns one way, so on a narrow window the links past its edge could not
 * be reached with a mouse. A mostly-sideways gesture (a trackpad) already
 * scrolls it natively, and at either end — or with nothing clipped — the wheel
 * belongs to the page.
 */
export const inlineScrollForWheel = (wheel: Wheel, strip: Strip): number | null => {
  if (Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY)) return null;
  const max = strip.scrollWidth - strip.clientWidth;
  if (max <= 0) return null;
  const delta = wheel.deltaMode === 1 ? wheel.deltaY * WHEEL_LINE_PX : wheel.deltaY;
  if (delta > 0 && strip.scrollLeft >= max - 1) return null;
  if (delta < 0 && strip.scrollLeft <= 0) return null;
  return delta;
};
