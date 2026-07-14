/**
 * @jest-environment jsdom
 */

import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  afterEach(() => {
    localStorage.clear();
    window.history.replaceState(window.history.state, "", "/");
    document.documentElement.classList.remove("dark", "light");
    document.body.className = "";
    document.body.innerHTML = "";
  });

  it("hydrates cleanly before applying the stored theme", async () => {
    window.history.replaceState(window.history.state, "", "/");
    const serverMarkup = renderToString(<ThemeToggle />);

    localStorage.setItem("darkMode", "false");
    document.body.innerHTML = `<div id="root">${serverMarkup}</div>`;

    const container = document.getElementById("root");
    expect(container).not.toBeNull();

    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      hydrateRoot(container!, <ThemeToggle />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("☀️");
    expect(container?.textContent).toContain("⟳");
    expect(document.body.classList.contains("light")).toBe(true);

    consoleError.mockRestore();
  });

  it("renders when localStorage access is unavailable", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const getItemSpy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    render(<ThemeToggle />);

    expect(screen.getByLabelText(/switch to (light|dark) theme/i)).toBeTruthy();

    getItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("swallows localStorage write failures when toggling", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const getItemSpy = jest.spyOn(Storage.prototype, "getItem").mockReturnValue("null");
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    render(<ThemeToggle />);
    fireEvent.click(screen.getByLabelText(/switch to (light|dark) theme/i));

    expect(setItemSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
    getItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("keeps showing a theme icon after reset", () => {
    render(<ThemeToggle />);

    // An explicit override must exist before the reset control appears.
    fireEvent.click(screen.getByLabelText(/switch to (light|dark) theme/i));
    fireEvent.click(screen.getByLabelText(/reset theme to system default/i));

    expect(screen.getByLabelText(/switch to (light|dark) theme/i).textContent).toMatch(/☀️|🌙/);
  });

  it("reflects the live system preference after reset, not the stale applied class", () => {
    // System prefers dark.
    const matchMediaSpy = jest.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return false;
          },
        }) as MediaQueryList,
    );

    render(<ThemeToggle />);

    // Force light explicitly — this applies the "light" class to <body>.
    fireEvent.click(screen.getByLabelText(/switch to light theme/i));
    expect(document.body.classList.contains("light")).toBe(true);

    // Reset to system default. The old code read document.body.classList during
    // this render (still "light" before the effect cleared it) and never
    // re-rendered, wrongly showing the light-theme icon. It must instead reflect
    // the dark system preference.
    fireEvent.click(screen.getByLabelText(/reset theme to system default/i));

    expect(screen.getByLabelText(/switch to (light|dark) theme/i).textContent).toContain("🌙");

    matchMediaSpy.mockRestore();
  });

  it("gives explicit URL themes precedence over stored preferences", () => {
    localStorage.setItem("darkMode", "false");
    window.history.replaceState(window.history.state, "", "/?theme=dark");
    const darkRender = render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeTruthy();
    expect(document.documentElement).toHaveClass("dark");
    darkRender.unmount();

    localStorage.setItem("darkMode", "true");
    window.history.replaceState(window.history.state, "", "/?theme=light");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeTruthy();
    expect(document.documentElement).toHaveClass("light");
  });

  it("defaults safely when matchMedia is unavailable", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });

    const { unmount } = render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeTruthy();
    unmount();

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });
});
