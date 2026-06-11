require("@testing-library/jest-dom");

// jsdom doesn't ship a ResizeObserver implementation. Provide a minimal stub so
// components that observe element size (e.g. the mobile nav scroll detector)
// can mount in tests without throwing.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom doesn't implement matchMedia. Components that respect
// prefers-reduced-motion call window.matchMedia(...); provide a stub that
// reports no preference so those effects can run in tests without throwing.
if (
  typeof window !== "undefined" &&
  typeof window.matchMedia !== "function"
) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
}

// jsdom doesn't implement scrollIntoView. Components that scroll the active
// nav item into view call element.scrollIntoView(...); provide a no-op so
// those effects don't throw in tests.
if (
  typeof window !== "undefined" &&
  typeof window.Element !== "undefined" &&
  typeof window.Element.prototype.scrollIntoView !== "function"
) {
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
}
