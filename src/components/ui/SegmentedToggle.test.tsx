/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { SegmentedToggle } from "./SegmentedToggle";

describe("SegmentedToggle roving tabindex", () => {
  it("moves focus to the newly selected option on arrow navigation", () => {
    render(
      <SegmentedToggle
        options={[
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
        ]}
        value="x"
        onChange={() => {}}
        ariaLabel="Test"
      />,
    );

    screen.getByText("X").focus();
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });

    expect(document.activeElement).toBe(screen.getByText("Y"));
  });

  it("wraps focus from the last option to the first", () => {
    render(
      <SegmentedToggle
        options={[
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
        ]}
        value="y"
        onChange={() => {}}
        ariaLabel="Test"
      />,
    );

    screen.getByText("Y").focus();
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });

    expect(document.activeElement).toBe(screen.getByText("X"));
  });
});
