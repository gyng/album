/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { ExploreOverview } from "./ExploreOverview";

describe("ExploreOverview", () => {
  it("renders the page heading and section navigation", () => {
    render(<ExploreOverview sectionLinks={[{ href: "#colour", label: "Colour" }]} />);

    expect(screen.getByRole("heading", { name: "Explore" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Colour" }).getAttribute("href")).toBe("#colour");
  });
});
