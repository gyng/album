/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { FacetLinkIcon } from "./FacetLinkIcon";

describe("FacetLinkIcon", () => {
  it("exposes its search destination and accessible label", () => {
    render(<FacetLinkIcon href="/search?facet=camera%3AX-T5" label="Find this camera" />);

    const link = screen.getByRole("link", { name: "Find this camera" });
    expect(link).toHaveAttribute("href", "/search?facet=camera%3AX-T5");
    expect(link).toHaveAttribute("title", "Find this camera");
  });
});
