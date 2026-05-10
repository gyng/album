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
