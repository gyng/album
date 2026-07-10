/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { ExploreOverview } from "./ExploreOverview";

describe("ExploreOverview", () => {
  it("renders the page heading, section navigation, and overview cards", () => {
    render(
      <ExploreOverview
        sectionLinks={[{ href: "#colour", label: "Colour" }]}
        cards={[{ label: "Photos", value: "12" }]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Explore" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Colour" }).getAttribute("href")).toBe(
      "#colour",
    );
    expect(screen.getByText("Photos")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });
});
