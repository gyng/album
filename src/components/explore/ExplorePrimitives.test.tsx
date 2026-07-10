/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { ExploreStatGroup, ExploreStatSection } from "./ExplorePrimitives";

describe("Explore primitives", () => {
  it("keeps linked section headings and optional actions", () => {
    render(
      <ExploreStatGroup
        id="where-you-shoot"
        title="Where you shoot"
        actions={<button type="button">Change view</button>}
      >
        <p>Map</p>
      </ExploreStatGroup>,
    );

    expect(screen.getByRole("link", { name: /where you shoot/i }).getAttribute("href")).toBe(
      "#where-you-shoot",
    );
    expect(screen.getByRole("button", { name: "Change view" })).toBeTruthy();
  });

  it("renders the established no-data message for empty facets", () => {
    render(
      <ExploreStatSection facetId="iso" title="ISO" coverage={0}>
        <span>unreachable bars</span>
      </ExploreStatSection>,
    );

    expect(screen.getByText("Available for 0% of archive")).toBeTruthy();
    expect(screen.getByText("No data available.")).toBeTruthy();
    expect(screen.queryByText("unreachable bars")).toBeNull();
  });
});
