/**
 * @jest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
import { useActiveTheme } from "./useActiveTheme";

const Probe = () => <span data-testid="theme">{useActiveTheme()}</span>;

describe("useActiveTheme", () => {
  afterEach(() => {
    document.documentElement.className = "";
  });

  it("reads the named theme the page is wearing", () => {
    document.documentElement.className = "dark theme-slate";

    render(<Probe />);

    expect(screen.getByTestId("theme")).toHaveTextContent("slate");
  });

  it("falls back to the scheme when no named theme is applied", () => {
    document.documentElement.className = "dark";
    render(<Probe />);
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });

  // The theme can arrive from the pre-paint script, from `?theme=`, or from
  // another tab — all of which reach the DOM without going through the picker.
  it("follows a change made to the root element", async () => {
    document.documentElement.className = "light";
    render(<Probe />);
    expect(screen.getByTestId("theme")).toHaveTextContent("light");

    // A mutation is delivered on a microtask, so the assertion has to wait for
    // one rather than reading the render that has not happened yet.
    await act(async () => {
      document.documentElement.className = "dark theme-ember";
      await Promise.resolve();
    });

    expect(screen.getByTestId("theme")).toHaveTextContent("ember");
  });
});
