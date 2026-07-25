/**
 * @jest-environment jsdom
 */

import { ALL_THEME_CLASSES } from "./theme";
import { THEME_BOOTSTRAP_SCRIPT } from "./themeBootstrap";

// The bootstrap script is a plain string injected inline by HTML entry
// adapters (see _document.tsx) — evaluate it the same way a <script> tag
// would, against the real jsdom window/document/localStorage.
const runBootstrapScript = () => {
  // oxlint-disable-next-line no-implied-eval -- executing the script string is the behaviour under test
  new Function(THEME_BOOTSTRAP_SCRIPT)();
};

describe("THEME_BOOTSTRAP_SCRIPT", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove(...ALL_THEME_CLASSES);
    document.body.classList.remove(...ALL_THEME_CLASSES);
  });

  it("starts dark when nothing has been chosen, and follows the OS only on request", () => {
    // A first visit gets the dark theme rather than whatever the OS happens to
    // be set to. Following the system is still available, but it is now a choice
    // someone makes rather than the absence of one — so it has to be stored, or
    // it would be indistinguishable from never having chosen.
    runBootstrapScript();
    expect(document.documentElement).toHaveClass("dark");
    expect(document.body).toHaveClass("dark");

    document.documentElement.classList.remove(...ALL_THEME_CLASSES);
    document.body.classList.remove(...ALL_THEME_CLASSES);
    localStorage.setItem("theme", "system");
    runBootstrapScript();
    for (const className of ALL_THEME_CLASSES) {
      expect(document.documentElement.classList.contains(className)).toBe(false);
    }
  });

  it("applies a stored legacy-alias theme even when persisting the migrated name fails", () => {
    localStorage.setItem("theme", "porcelain");
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    runBootstrapScript();

    // The valid stored preference (resolved via the legacy alias) must still
    // apply, even though the best-effort migration write threw.
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("theme-watercolour")).toBe(true);
    expect(document.body.classList.contains("light")).toBe(true);
    expect(document.body.classList.contains("theme-watercolour")).toBe(true);

    setItemSpy.mockRestore();
  });

  it("still migrates the stored alias to its canonical name when storage works", () => {
    localStorage.setItem("theme", "porcelain");

    runBootstrapScript();

    expect(localStorage.getItem("theme")).toBe("watercolour");
    expect(document.documentElement.classList.contains("theme-watercolour")).toBe(true);
  });

  it("applies a directly stored theme with no migration necessary", () => {
    localStorage.setItem("theme", "ink");

    runBootstrapScript();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-ink")).toBe(true);
  });

  it("does not resolve Object.prototype members as theme aliases from the URL or storage", () => {
    window.history.pushState({}, "", "/?theme=constructor");

    runBootstrapScript();

    // Neither an inherited alias lookup nor a scheme lookup must match: no named
    // palette is applied, and the value falls through to the default rather than
    // resolving to whatever `constructor` happens to inherit.
    const namedClasses = ALL_THEME_CLASSES.filter((cls) => cls.startsWith("theme-"));
    expect(document.documentElement.classList.contains("theme-watercolour")).toBe(false);
    for (const cls of namedClasses) {
      expect(document.documentElement.classList.contains(cls)).toBe(false);
    }
    expect(document.documentElement).toHaveClass("dark");

    window.history.pushState({}, "", "/");
    document.documentElement.classList.remove(...ALL_THEME_CLASSES);
    localStorage.setItem("theme", "constructor");

    runBootstrapScript();

    for (const cls of namedClasses) {
      expect(document.documentElement.classList.contains(cls)).toBe(false);
    }
    expect(document.documentElement).toHaveClass("dark");
  });
});
