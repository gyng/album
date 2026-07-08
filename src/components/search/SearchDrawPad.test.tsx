/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { SearchDrawPad } from "./SearchDrawPad";

// jsdom has no canvas implementation — getContext returns null and the
// component guards for that, so drawing itself is not exercised here.
describe("SearchDrawPad focus management", () => {
  it("moves focus into the dialog on open", () => {
    render(<SearchDrawPad onCancel={jest.fn()} onSubmit={jest.fn()} />);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });

  it("restores focus to the previously focused element on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Draw to search";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <SearchDrawPad onCancel={jest.fn()} onSubmit={jest.fn()} />,
    );
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it("wraps Tab from the last control back to the first", () => {
    render(<SearchDrawPad onCancel={jest.fn()} onSubmit={jest.fn()} />);

    // Search is disabled until a stroke exists, so Cancel is the last
    // focusable control.
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab" });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Brush colour #1a1a1a" }),
    );
  });

  it("wraps Shift+Tab from the first control back to the last", () => {
    render(<SearchDrawPad onCancel={jest.fn()} onSubmit={jest.fn()} />);

    const firstSwatch = screen.getByRole("button", {
      name: "Brush colour #1a1a1a",
    });
    firstSwatch.focus();
    fireEvent.keyDown(firstSwatch, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });

  it("closes on Escape", () => {
    const onCancel = jest.fn();
    render(<SearchDrawPad onCancel={onCancel} onSubmit={jest.fn()} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and releases it on close", () => {
    const { unmount } = render(
      <SearchDrawPad onCancel={jest.fn()} onSubmit={jest.fn()} />,
    );
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
