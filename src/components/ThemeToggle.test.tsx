/**
 * @jest-environment jsdom
 */

import React, { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  afterEach(() => {
    localStorage.clear();
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
    const getItemSpy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      });

    render(<ThemeToggle />);

    expect(screen.getByTitle(/toggle dark mode/i)).toBeTruthy();

    getItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("swallows localStorage write failures when toggling", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const getItemSpy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockReturnValue("null");
    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      });

    render(<ThemeToggle />);
    fireEvent.click(screen.getByTitle(/toggle dark mode/i));

    expect(setItemSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
    getItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("keeps showing a theme icon after reset", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByTitle(/reset to system default/i));

    expect(screen.getByTitle(/toggle dark mode/i).textContent).toMatch(
      /☀️|🌙/,
    );
  });
});
