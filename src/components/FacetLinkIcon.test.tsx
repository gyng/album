/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { FacetLinkIcon } from "./FacetLinkIcon";

describe("FacetLinkIcon", () => {
  it("exposes its search destination and accessible label", () => {
    const { rerender } = render(
      <FacetLinkIcon href="/search?facet=camera%3AX-T5" label="Find this camera" />,
    );

    const link = screen.getByRole("link", { name: "Find this camera" });
    expect(link).toHaveAttribute("href", "/search?facet=camera%3AX-T5");
    expect(link).toHaveAttribute("title", "Find this camera");

    rerender(
      <FacetLinkIcon
        href="/search?facet=lens%3AXF23"
        label="Find this lens"
        className="context-link"
      />,
    );
    expect(screen.getByRole("link", { name: "Find this lens" })).toHaveClass("context-link");
  });
});
