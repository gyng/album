/**
 * @jest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreStatGroup, ExploreStatSection, VisualSimilarityThumb } from "./ExplorePrimitives";

describe("Explore primitives", () => {
  it("keeps a meaningful summary in server-rendered HTML while deferring heavy content", () => {
    const markup = renderToStaticMarkup(
      <ExploreStatGroup
        id="deferred-summary"
        title="Deferred summary"
        deferContent
        deferredSummary={<p>42 photos across 3 years</p>}
      >
        <p>Expensive interactive chart</p>
      </ExploreStatGroup>,
    );

    expect(markup).toContain("42 photos across 3 years");
    expect(markup).not.toContain("Expensive interactive chart");
  });

  it("defers expensive group content until the group nears the viewport", () => {
    let intersectionCallback!: IntersectionObserverCallback;
    const disconnect = jest.fn();
    const observe = jest.fn();
    const unobserve = jest.fn();
    const originalObserver = globalThis.IntersectionObserver;
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: jest.fn((callback: IntersectionObserverCallback) => {
        intersectionCallback = callback;
        return { disconnect, observe, unobserve };
      }),
    });

    const view = render(
      <ExploreStatGroup id="deferred" title="Deferred" deferContent>
        <p>Expensive chart</p>
      </ExploreStatGroup>,
    );

    expect(screen.getByRole("heading", { name: /deferred/i })).toBeInTheDocument();
    expect(screen.queryByText("Expensive chart")).toBeNull();
    expect(observe).toHaveBeenCalledTimes(1);

    act(() => {
      intersectionCallback(
        [{ target: observe.mock.calls[0]![0], isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(screen.getByText("Expensive chart")).toBeInTheDocument();
    expect(disconnect).toHaveBeenCalled();
    view.unmount();

    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: originalObserver,
    });
  });

  // At 390px the whole page is ~61 screens tall with every group expanded, so a
  // phone reader has to scroll the entire archive analysis to reach anything.
  // Narrow viewports get the summary plus a control instead.
  describe("on a narrow viewport", () => {
    const setViewport = (isNarrow: boolean) => {
      jest.spyOn(window, "matchMedia").mockReturnValue({
        matches: isNarrow,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      } as unknown as MediaQueryList);
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("collapses a group behind its summary until the reader opens it", () => {
      setViewport(true);
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

      expect(screen.getByText("Ten years")).toBeInTheDocument();
      expect(screen.queryByText("Expensive chart")).toBeNull();
      // Scope filters act on content that is not on screen.
      expect(screen.queryByText("Filter by camera")).toBeNull();

      act(() => {
        screen.getByRole("button", { name: /when you shoot/i }).click();
      });
      expect(screen.getByText("Expensive chart")).toBeInTheDocument();
    });

    it("leaves wide viewports expanded, with no control to press", () => {
      setViewport(false);
      render(
        <ExploreStatGroup id="when" title="When you shoot" deferredSummary={<p>Ten years</p>}>
          <p>Expensive chart</p>
        </ExploreStatGroup>,
      );

      expect(screen.getByText("Expensive chart")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /when you shoot/i })).toBeNull();
    });

    // The observed element only exists once the group is open, so opening one
    // has to (re)attach the intersection observer. Without that, a deferred
    // group opened by hand sits on its placeholder for good.
    it("fills in a deferred group that the reader opens", () => {
      setViewport(true);
      let intersectionCallback!: IntersectionObserverCallback;
      const observe = jest.fn();
      const originalObserver = globalThis.IntersectionObserver;
      Object.defineProperty(globalThis, "IntersectionObserver", {
        configurable: true,
        value: jest.fn((callback: IntersectionObserverCallback) => {
          intersectionCallback = callback;
          return { disconnect: jest.fn(), observe, unobserve: jest.fn() };
        }),
      });

      render(
        <ExploreStatGroup
          id="colour"
          title="Colour"
          deferContent
          deferredSummary={<p>Ten years</p>}
        >
          <p>Expensive chart</p>
        </ExploreStatGroup>,
      );
      // The group renders open first so server HTML keeps the content, then
      // collapses once the media query resolves — which unmounts the node the
      // observer was watching.
      const observedBeforeCollapse = observe.mock.calls.length;
      expect(screen.queryByText("Expensive chart")).toBeNull();

      act(() => {
        screen.getByRole("button", { name: /colour/i }).click();
      });
      expect(observe.mock.calls.length).toBeGreaterThan(observedBeforeCollapse);

      act(() => {
        intersectionCallback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
      expect(screen.getByText("Expensive chart")).toBeInTheDocument();

      Object.defineProperty(globalThis, "IntersectionObserver", {
        configurable: true,
        value: originalObserver,
      });
    });

    // The "Jump to" nav is same-page links, so the hash almost always changes
    // after mount. Reading it once left every jump landing on a closed group.
    it("opens a group when the reader jumps to it", () => {
      setViewport(true);
      render(
        <ExploreStatGroup id="colour" title="Colour" deferredSummary={<p>Ten years</p>}>
          <p>Expensive chart</p>
        </ExploreStatGroup>,
      );
      expect(screen.queryByText("Expensive chart")).toBeNull();

      act(() => {
        window.location.hash = "#colour";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      expect(screen.getByText("Expensive chart")).toBeInTheDocument();
      window.location.hash = "";
    });

    // The "Jump to" nav links straight at a group; arriving there collapsed
    // would make the link look broken.
    it("opens a group that the URL points at", () => {
      setViewport(true);
      window.location.hash = "#when";
      render(
        <ExploreStatGroup id="when" title="When you shoot" deferredSummary={<p>Ten years</p>}>
          <p>Expensive chart</p>
        </ExploreStatGroup>,
      );

      expect(screen.getByText("Expensive chart")).toBeInTheDocument();
      window.location.hash = "";
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
