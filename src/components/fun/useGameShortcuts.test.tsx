/** @jest-environment jsdom */
import { fireEvent, renderHook } from "@testing-library/react";
import { GameReadinessProvider } from "./GameReadiness";
import type { ReactNode } from "react";
import { useGameShortcuts } from "./useGameShortcuts";

it("uses current actions and ignores repeats, disabled actions and modifiers", () => {
  const first = jest.fn(),
    second = jest.fn();
  const { rerender } = renderHook(
    ({ action }) => useGameShortcuts([{ key: "H", label: "Hint", action }]),
    { initialProps: { action: first } },
  );
  fireEvent.keyDown(window, { key: "h" });
  expect(first).toHaveBeenCalledTimes(1);
  rerender({ action: second });
  fireEvent.keyDown(window, { key: "H" });
  fireEvent.keyDown(window, { key: "h", ctrlKey: true });
  fireEvent.keyDown(window, { key: "h", repeat: true });
  expect(second).toHaveBeenCalledTimes(1);
});

it("preserves typing, native activation and modal interactions", () => {
  const action = jest.fn();
  renderHook(() =>
    useGameShortcuts([
      { key: "H", label: "Hint", action },
      { key: "Enter", label: "Check", action },
    ]),
  );
  const input = document.createElement("input"),
    button = document.createElement("button");
  document.body.append(input, button);
  fireEvent.keyDown(input, { key: "h" });
  fireEvent.keyDown(button, { key: "Enter" });
  expect(action).not.toHaveBeenCalled();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);
  fireEvent.keyDown(window, { key: "h" });
  expect(action).not.toHaveBeenCalled();
  input.remove();
  button.remove();
  dialog.remove();
  fireEvent.keyDown(window, { key: "Enter" });
  expect(action).toHaveBeenCalledTimes(1);
});

it("does not consume disabled or inactive shortcuts and removes the listener on unmount", () => {
  const action = jest.fn();
  const { unmount } = renderHook(() =>
    useGameShortcuts([{ key: "G", label: "Give up", action, enabled: false }]),
  );
  expect(fireEvent.keyDown(window, { key: "g" })).toBe(true);
  unmount();
  renderHook(() => useGameShortcuts([{ key: "G", label: "Give up", action }], false));
  fireEvent.keyDown(window, { key: "g" });
  expect(action).not.toHaveBeenCalled();
});

it("blocks game actions while photographs load", () => {
  const action = jest.fn();
  renderHook(() => useGameShortcuts([{ key: "N", label: "Start", action }]), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <GameReadinessProvider
        value={{ loading: true, showProgress: false, progress: 0, error: null, retry: () => {} }}
      >
        {children}
      </GameReadinessProvider>
    ),
  });
  expect(fireEvent.keyDown(window, { key: "n" })).toBe(true);
  expect(action).not.toHaveBeenCalled();
});
