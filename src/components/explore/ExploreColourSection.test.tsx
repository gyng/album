/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { PhotoStats } from "../../util/computeStats";
import { ExploreColourSection } from "./ExploreColourSection";

describe("ExploreColourSection", () => {
  it("renders colour-family totals and preserves the search link", () => {
    const stats = {
      colorCoverage: 1,
      colorStats: [{ label: "Blue", count: 6 }],
      colorFamilyExamples: [],
      colorYearRibbons: [],
    } as PhotoStats;

    render(<ExploreColourSection stats={stats} />);

    expect(screen.getByRole("heading", { name: "Colour" })).toBeTruthy();
    expect(screen.getByText("Dominant colour families")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /find photos with similar blue tones/i })
        .getAttribute("href"),
    ).toBe("/search?color=93%2C132%2C214");
  });
});
