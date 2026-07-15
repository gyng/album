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
        className="outer"
        imageClassName="image"
      />,
    );
    expect(screen.getByRole("img", { name: "Lantern street" })).toHaveClass("image");
    expect(screen.getByRole("link", { name: "Lantern street" })).toHaveAttribute(
      "href",
      "/album/test-simple#photo-one",
    );
    expect(screen.getByRole("link", { name: /Find photos semantically similar/ })).toHaveAttribute(
      "href",
      "/search?similar=..%2Falbums%2Ftest-simple%2Fphoto+one.jpg",
    );
  });

  it("accepts default thumbnail classes", () => {
    const { container } = render(
      <VisualSimilarityThumb
        photo={{ path: "photo.jpg", src: "/photo.jpg", href: "/photo", label: "Photo" }}
      />,
    );
    expect(container.firstElementChild).toBeInTheDocument();
  });
});
