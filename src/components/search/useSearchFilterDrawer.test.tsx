/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useSearchFilterDrawer } from "./useSearchFilterDrawer";

const Harness = ({ isSimilarMode = false }: { isSimilarMode?: boolean }) => {
  const { isCompact, isOpen, open, close, dialogRef, triggerRef, closeRef } = useSearchFilterDrawer(
    { isSimilarMode },
  );

  if (!isCompact) {
    return <span>Inline filters</span>;
  }

  return (
    <>
      <button ref={triggerRef} type="button" aria-expanded={isOpen} onClick={open}>
        Open
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Search filters"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <button ref={closeRef} type="button" onClick={close}>
          Done
        </button>
      </dialog>
    </>
  );
};

describe("useSearchFilterDrawer", () => {
  beforeEach(() => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 900px)",
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  });

  it("opens a native modal, handles cancellation, and restores trigger focus", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Search filters" });
    expect(dialog).toHaveAttribute("open");
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();

    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });

  it("closes when similarity mode takes over", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    rerender(<Harness isSimilarMode />);

    expect(document.querySelector("dialog")).not.toHaveAttribute("open");
  });
});
