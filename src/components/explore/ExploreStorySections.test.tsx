/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { ExploreFunStatsSection } from "./ExploreStorySections";

describe("Explore story sections", () => {
  it("renders fun-stat copy and its optional search action", () => {
    render(
      <ExploreFunStatsSection
        cards={[
          {
            label: "Colour mood",
            value: "Blue",
            detail: "Six photos lean into this family.",
            actionHref: "/search?color=blue",
          },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: /fun stats/i })).toBeTruthy();
    expect(screen.getByText("Blue")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /open in search/i }).getAttribute("href"),
    ).toBe("/search?color=blue");
  });
});
