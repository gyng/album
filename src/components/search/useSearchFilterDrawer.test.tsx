/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useSearchFilterDrawer } from "./useSearchFilterDrawer";

const Harness = ({ isSimilarMode = false }: { isSimilarMode?: boolean }) => {
  const { isOpen, open, close, triggerRef, closeRef } = useSearchFilterDrawer({ isSimilarMode });
  return (
    <>
      <button ref={triggerRef} type="button" onClick={open}>
        Open
      </button>
      {isOpen ? (
        <button ref={closeRef} type="button" onClick={close}>
          Done
        </button>
      ) : null}
    </>
  );
};

describe("useSearchFilterDrawer", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("locks scroll, handles Escape, and restores focus to the trigger", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });

    fireEvent.click(trigger);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });

  it("closes when similarity mode takes over", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    rerender(<Harness isSimilarMode />);

    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });
});
