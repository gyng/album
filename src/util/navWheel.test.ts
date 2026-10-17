import { inlineScrollForWheel } from "./navWheel";

const strip = { scrollLeft: 100, scrollWidth: 1100, clientWidth: 300 };

describe("inlineScrollForWheel", () => {
  // A mouse wheel only turns one way, and the nav hides its scrollbar, so on a
  // narrow window the clipped links could not be reached with a mouse at all.
  it("turns a vertical wheel into sideways scrolling of an overflowing strip", () => {
    expect(inlineScrollForWheel({ deltaX: 0, deltaY: 120, deltaMode: 0 }, strip)).toBe(120);
    expect(inlineScrollForWheel({ deltaX: 0, deltaY: -40, deltaMode: 0 }, strip)).toBe(-40);
  });

  it("reads a line-mode wheel in lines", () => {
    expect(inlineScrollForWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 }, strip)).toBe(48);
  });

  // A trackpad's sideways swipe already scrolls the strip natively.
  it("leaves a mostly-sideways gesture to the browser", () => {
    expect(inlineScrollForWheel({ deltaX: 30, deltaY: 10, deltaMode: 0 }, strip)).toBeNull();
  });

  // At either end, or with nothing to scroll, the wheel belongs to the page.
  it("hands the wheel back at either end and when nothing overflows", () => {
    const atEnd = { ...strip, scrollLeft: 800 };
    expect(inlineScrollForWheel({ deltaX: 0, deltaY: 50, deltaMode: 0 }, atEnd)).toBeNull();
    const atStart = { ...strip, scrollLeft: 0 };
    expect(inlineScrollForWheel({ deltaX: 0, deltaY: -50, deltaMode: 0 }, atStart)).toBeNull();
    const fits = { scrollLeft: 0, scrollWidth: 300, clientWidth: 300 };
    expect(inlineScrollForWheel({ deltaX: 0, deltaY: 50, deltaMode: 0 }, fits)).toBeNull();
  });
});
