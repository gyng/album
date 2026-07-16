/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { MapRecencyLegend } from "./MapRecencyLegend";

describe("MapRecencyLegend", () => {
  it("explains the recency colour ramp with useful default labels", () => {
    const { rerender } = render(<MapRecencyLegend />);

    expect(screen.getByText("Older")).toBeTruthy();
    expect(screen.getByText("Newer")).toBeTruthy();

    rerender(<MapRecencyLegend olderLabel="2018" newerLabel="2026" />);
    expect(screen.getByText("2018")).toBeTruthy();
    expect(screen.getByText("2026")).toBeTruthy();
  });
});
