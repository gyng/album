/**
 * @jest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreStatGroup, ExploreStatSection, VisualSimilarityThumb } from "./ExplorePrimitives";

const groupSection = (container: HTMLElement): HTMLElement => {
  const section = container.querySelector("section");
  if (!section) {
    throw new Error("ExploreStatGroup rendered no section element");
  }
  return section;
};

describe("Explore primitives", () => {
  it("renders group content into the server HTML, not a placeholder", () => {
    const markup = renderToStaticMarkup(
      <ExploreStatGroup
        id="colour"
        title="Colour"
        deferredSummary={<p>42 photos across 3 years</p>}
      >
        <p>Expensive interactive chart</p>
      </ExploreStatGroup>,
    );

    // The collapse is a CSS decision, so the content is already in the first
    // paint at every width and there is nothing for hydration to shift.
    expect(markup).toContain("42 photos across 3 years");
    expect(markup).toContain("Expensive interactive chart");
    expect(markup).not.toContain("aria-busy");
  });

  it("renders the content, summary and control in the first client render", () => {
    const view = render(
      <ExploreStatGroup id="colour" title="Colour" deferredSummary={<p>Ten years</p>}>
        <p>Expensive chart</p>
      </ExploreStatGroup>,
    );

    expect(screen.getByText("Expensive chart")).toBeInTheDocument();
    expect(screen.getByText("Ten years")).toBeInTheDocument();
    expect(view.container.querySelector("[aria-busy]")).toBeNull();

    const section = groupSection(view.container);
    expect(section).toHaveAttribute("data-opened", "false");
    expect(section).toHaveAttribute("data-linked", "false");
  });

  it("names the collapse control after its group", () => {
    render(
      <ExploreStatGroup id="when" title="When you shoot" deferredSummary={<p>Ten years</p>}>
        <p>Expensive chart</p>
      </ExploreStatGroup>,
    );

    const toggle = screen.getByRole("button", { name: "Show When you shoot" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "when-content");
    expect(screen.getByText("Expensive chart").closest("#when-content")).not.toBeNull();
  });

  it("opens and closes a group the reader toggles", () => {
    const view = render(
      <ExploreStatGroup id="when" title="When you shoot" deferredSummary={<p>Ten years</p>}>
        <p>Expensive chart</p>
      </ExploreStatGroup>,
    );

    act(() => screen.getByRole("button", { name: "Show When you shoot" }).click());

    // `data-opened` is the whole reason a narrow group is open — the stylesheet
    // reads it, this component does not branch on a viewport.
    expect(groupSection(view.container)).toHaveAttribute("data-opened", "true");
    const opened = screen.getByRole("button", { name: "Hide When you shoot" });
    expect(opened).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Expensive chart")).toBeInTheDocument();

    act(() => opened.click());
    expect(groupSection(view.container)).toHaveAttribute("data-opened", "false");
    expect(screen.getByRole("button", { name: "Show When you shoot" })).toBeInTheDocument();
  });

  // The collapse itself is a stylesheet decision — these pin the DOM contract
  // it reads, so the narrow-viewport summary, control, and hash-open behaviour
  // survive a refactor of the CSS.
  describe("the narrow-viewport collapse contract", () => {
    afterEach(() => {
      window.location.hash = "";
    });

    it("keeps the summary, the control, the actions and the content in the DOM", () => {
      render(
        <ExploreStatGroup
          id="when"
          title="When you shoot"
          deferredSummary={<p>Ten years</p>}
          actions={<p>Filter by camera</p>}
        >
          <p>Expensive chart</p>
        </ExploreStatGroup>,
      );

      // What a collapsed group must not show is hidden by the stylesheet; the
      // component renders all of it so the first paint is already the server's.
      expect(screen.getByText("Ten years")).toBeInTheDocument();
      expect(screen.getByText("Expensive chart")).toBeInTheDocument();
      expect(screen.getByText("Filter by camera")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show When you shoot" })).toBeInTheDocument();
    });

    it("opens a group the URL hash points at, on arrival", () => {
      window.location.hash = "#when";
      const view = render(
        <ExploreStatGroup id="when" title="When you shoot" deferredSummary={<p>Ten years</p>}>
          <p>Expensive chart</p>
        </ExploreStatGroup>,
      );

      expect(groupSection(view.container)).toHaveAttribute("data-linked", "true");
      expect(screen.getByRole("button", { name: "Hide When you shoot" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    // The "Jump to" nav is same-page links, so the hash almost always changes
    // after mount. Reading it once left every jump landing on a closed group.
    it("opens a group when the reader jumps to it", () => {
      const view = render(
        <ExploreStatGroup id="colour" title="Colour" deferredSummary={<p>Ten years</p>}>
          <p>Expensive chart</p>
        </ExploreStatGroup>,
      );
      expect(groupSection(view.container)).toHaveAttribute("data-linked", "false");

      act(() => {
        window.location.hash = "#colour";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });

      expect(groupSection(view.container)).toHaveAttribute("data-linked", "true");
      expect(screen.getByText("Expensive chart")).toBeInTheDocument();
    });

    // A "Jump to" link must never land on a closed section, so the hash keeps
    // the group open even after the reader presses the control.
    it("keeps a hash-linked group open when the reader presses its control", () => {
      window.location.hash = "#colour";
      const view = render(
        <ExploreStatGroup id="colour" title="Colour" deferredSummary={<p>Ten years</p>}>
          <p>Expensive chart</p>
        </ExploreStatGroup>,
      );

      act(() => screen.getByRole("button", { name: "Hide Colour" }).click());
      act(() => screen.getByRole("button", { name: "Hide Colour" }).click());

      expect(groupSection(view.container)).toHaveAttribute("data-opened", "false");
      expect(screen.getByRole("button", { name: "Hide Colour" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });
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
