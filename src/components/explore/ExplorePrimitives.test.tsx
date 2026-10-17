/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreStatGroup, ExploreStatSection, VisualSimilarityThumb } from "./ExplorePrimitives";

describe("Explore primitives", () => {
  it("renders group content and actions into the server HTML", () => {
    const markup = renderToStaticMarkup(
      <ExploreStatGroup id="colour" title="Colour" actions={<p>Filter by camera</p>}>
        <p>Expensive interactive chart</p>
      </ExploreStatGroup>,
    );

    // Nothing is mounted, collapsed or expanded after hydration, so the first
    // paint is already the final layout at every width.
    expect(markup).toContain("Expensive interactive chart");
    expect(markup).toContain("Filter by camera");
    expect(markup).not.toContain("<button");
  });

  it("keeps linked section headings and optional actions", () => {
    render(
      <ExploreStatGroup
        id="where-you-shoot"
        title="Where you shoot"
        description="Places represented in the archive"
        actions={<button type="button">Change view</button>}
      >
        <p>Map</p>
      </ExploreStatGroup>,
    );

    expect(screen.getByRole("link", { name: /where you shoot/i }).getAttribute("href")).toBe(
      "#where-you-shoot",
    );
    expect(screen.getByRole("button", { name: "Change view" })).toBeTruthy();
    expect(screen.getByText("Places represented in the archive")).toBeInTheDocument();
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

  it("renders populated wide facets", () => {
    const { container } = render(
      <ExploreStatSection facetId="hour" title="Time" coverage={0.625}>
        <span>Chart content</span>
      </ExploreStatSection>,
    );
    expect(screen.getByText("Available for 63% of archive")).toBeInTheDocument();
    expect(screen.getByText("Chart content")).toBeInTheDocument();
    expect(container.querySelector("section")?.className).toContain("sectionWide");
  });

  it("renders an unlinked group with optional metadata omitted", () => {
    render(
      <ExploreStatGroup title="Camera choices">
        <p>Camera chart</p>
      </ExploreStatGroup>,
    );
    expect(screen.getByRole("heading", { name: "Camera choices" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Camera choices" })).toBeNull();
  });

  it("links a representative photo to both its album and similarity search", () => {
    render(
      <VisualSimilarityThumb
        photo={{
          path: "../albums/test-simple/photo one.jpg",
          src: "/photo.jpg",
          href: "/album/test-simple#photo-one",
          label: "Lantern street",
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "Lantern street" })).toHaveAttribute(
      "src",
      "/photo.jpg",
    );
    expect(screen.getByRole("link", { name: "Lantern street" })).toHaveAttribute(
      "href",
      "/album/test-simple#photo-one",
    );
    expect(screen.getByRole("img", { name: "Lantern street" })).not.toHaveStyle({
      backgroundColor: "rgb(10, 20, 30)",
    });
    expect(screen.getByRole("link", { name: /Find photos semantically similar/ })).toHaveAttribute(
      "href",
      "/search?similar=..%2Falbums%2Ftest-simple%2Fphoto+one.jpg",
    );
  });

  it("backs the thumbnail with the photo's dominant colour swatch", () => {
    render(
      <VisualSimilarityThumb
        photo={{
          path: "../albums/test-simple/photo one.jpg",
          src: "/photo.jpg",
          href: "/album/test-simple#photo-one",
          label: "Lantern street",
          swatch: "rgb(10, 20, 30)",
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "Lantern street" })).toHaveStyle({
      backgroundColor: "rgb(10, 20, 30)",
    });
  });
});
