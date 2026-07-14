/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { SearchFilterPill } from "./SearchFilterPill";

describe("SearchFilterPill", () => {
  it("works as a count-free toggle", () => {
    const onClick = jest.fn();
    const { rerender } = render(<SearchFilterPill label="Colour" onClick={onClick} />);

    const button = screen.getByRole("button", { name: "Colour" });
    expect(button).not.toHaveAttribute("aria-pressed");
    expect(button).toHaveTextContent("Colour");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<SearchFilterPill label="Colour" count={0} isActive disabled onClick={onClick} />);
    expect(screen.getByRole("button", { name: "Colour 0" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Colour 0" })).toBeDisabled();
  });
});
