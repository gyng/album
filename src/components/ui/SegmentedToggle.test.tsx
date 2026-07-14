/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { SegmentedToggle } from "./SegmentedToggle";

describe("SegmentedToggle roving tabindex", () => {
  it("announces selection and changes options with pointer input", () => {
    const onChange = jest.fn();
    render(
      <SegmentedToggle
        options={[
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
        ]}
        value="x"
        onChange={onChange}
        ariaLabel="Display mode"
        className="compact"
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Display mode" });
    const [x, y] = screen.getAllByRole("radio");
    expect(group).toHaveClass("compact");
    expect(x).toHaveAttribute("aria-checked", "true");
    expect(x).toHaveAttribute("tabindex", "0");
    expect(y).toHaveAttribute("aria-checked", "false");
    expect(y).toHaveAttribute("tabindex", "-1");

    fireEvent.click(y);
    expect(onChange).toHaveBeenCalledWith("y");
  });

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

  it.each([
    ["ArrowDown", "Y"],
    ["ArrowLeft", "Y"],
    ["ArrowUp", "Y"],
  ])("supports %s navigation", (key, expected) => {
    const onChange = jest.fn();
    render(
      <SegmentedToggle
        options={[
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
        ]}
        value="x"
        onChange={onChange}
        ariaLabel="Test"
      />,
    );

    fireEvent.keyDown(screen.getByRole("radio", { name: "X" }), { key });

    expect(onChange).toHaveBeenCalledWith(expected.toLowerCase());
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: expected }));
  });

  it("ignores unrelated keys and an unknown current value", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <SegmentedToggle
        options={[{ value: "x", label: "X" }]}
        value="x"
        onChange={onChange}
        ariaLabel="Test"
      />,
    );
    fireEvent.keyDown(screen.getByRole("radio"), { key: "Home" });

    rerender(
      <SegmentedToggle
        options={[{ value: "x", label: "X" }]}
        value={"missing" as "x"}
        onChange={onChange}
        ariaLabel="Test"
      />,
    );
    fireEvent.keyDown(screen.getByRole("radio"), { key: "ArrowRight" });

    expect(onChange).not.toHaveBeenCalled();
  });
});
