/**
 * @jest-environment jsdom
 */

import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { ALL_THEME_CLASSES } from "../util/theme";
import { ThemeToggle } from "./ThemeToggle";

const getPicker = () => screen.getByRole("combobox", { name: "Theme" });

describe("ThemeToggle", () => {
  afterEach(() => {
    localStorage.clear();
    window.history.replaceState(window.history.state, "", "/");
    document.documentElement.classList.remove(...ALL_THEME_CLASSES);
    document.body.className = "";
    document.body.innerHTML = "";
  });

  it("hydrates cleanly before applying the stored theme", async () => {
    const serverMarkup = renderToString(<ThemeToggle />);

    localStorage.setItem("theme", "paper");
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
    expect(getPicker()).toHaveValue("paper");
    // A named theme applies its base scheme class plus its palette class.
    expect(document.body.classList.contains("light")).toBe(true);
    expect(document.body.classList.contains("theme-paper")).toBe(true);

    consoleError.mockRestore();
  });

  it("applies and persists a selected theme", () => {
    render(<ThemeToggle />);

    fireEvent.change(getPicker(), { target: { value: "slate" } });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-slate")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("slate");
  });

  it.each([
    ["watercolour", "Watercolour", "light"],
    ["ember", "Ember", "dark"],
    ["bling", "Bling", "dark"],
    ["herbarium", "Herbarium", "light"],
    ["arcana", "Arcana", "dark"],
    ["terminal", "Terminal", "dark"],
    ["desktop", "Desktop 84", "light"],
  ])("offers and applies the %s theme", (value, label, scheme) => {
    render(<ThemeToggle />);

    expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    fireEvent.change(getPicker(), { target: { value } });

    expect(document.documentElement).toHaveClass(scheme);
    expect(document.documentElement).toHaveClass(`theme-${value}`);
    expect(document.body).toHaveClass(scheme);
    expect(document.body).toHaveClass(`theme-${value}`);
    expect(localStorage.getItem("theme")).toBe(value);
  });

  it("honours a legacy darkMode preference and migrates it on change", () => {
    localStorage.setItem("darkMode", "true");

    render(<ThemeToggle />);
    expect(getPicker()).toHaveValue("dark");

    fireEvent.change(getPicker(), { target: { value: "light" } });

    expect(localStorage.getItem("theme")).toBe("light");
    expect(localStorage.getItem("darkMode")).toBeNull();
  });

  it("honours the renamed porcelain preference as Watercolour", () => {
    localStorage.setItem("theme", "porcelain");

    render(<ThemeToggle />);

    expect(getPicker()).toHaveValue("watercolour");
    expect(document.documentElement).toHaveClass("theme-watercolour");
  });

  it("gives explicit URL themes precedence over stored preferences", () => {
    localStorage.setItem("theme", "light");
    window.history.replaceState(window.history.state, "", "/?theme=ink");

    render(<ThemeToggle />);

    expect(getPicker()).toHaveValue("ink");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveClass("theme-ink");
  });

  it("returns to the system default, clearing classes and storage", () => {
    localStorage.setItem("theme", "dark");

    render(<ThemeToggle />);
    expect(document.documentElement).toHaveClass("dark");

    fireEvent.change(getPicker(), { target: { value: "system" } });

    for (const className of ALL_THEME_CLASSES) {
      expect(document.documentElement.classList.contains(className)).toBe(false);
      expect(document.body.classList.contains(className)).toBe(false);
    }
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("renders when localStorage access is unavailable", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const getItemSpy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    render(<ThemeToggle />);

    expect(getPicker()).toBeTruthy();

    getItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("swallows localStorage write failures when changing theme", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const getItemSpy = jest.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    render(<ThemeToggle />);
    fireEvent.change(getPicker(), { target: { value: "dark" } });

    expect(setItemSpy).toHaveBeenCalled();
    // The theme still applies for the session even when it cannot persist.
    expect(document.documentElement).toHaveClass("dark");

    setItemSpy.mockRestore();
    getItemSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
