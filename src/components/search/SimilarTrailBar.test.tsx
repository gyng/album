/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { forceDocumentNavigation } from "./searchUtils";
import { SimilarTrailBar } from "./SimilarTrailBar";

jest.mock("./searchUtils", () => ({
  ...jest.requireActual("./searchUtils"),
  forceDocumentNavigation: jest.fn((event: Event) => event.preventDefault()),
}));

const navigate = jest.mocked(forceDocumentNavigation);
const baseProps = () => ({
  similarPath: "../albums/test-simple/source photo.jpg",
  similarPreviewSrc: "/source.jpg",
  similarFilename: "source photo.jpg",
  similarityOrder: "most" as const,
  trail: [],
  sourceRef: createRef<HTMLDivElement>(),
  onSetSimilarityOrder: jest.fn(),
  onTruncate: jest.fn(),
});

describe("SimilarTrailBar", () => {
  const frames: FrameRequestCallback[] = [];
  let left = 10;

  beforeEach(() => {
    jest.resetAllMocks();
    frames.length = 0;
    left = 10;
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      left,
      top: 0,
      right: left + 10,
      bottom: 10,
      width: 10,
      height: 10,
      x: left,
      y: 0,
      toJSON() {},
    }));
  });

  afterEach(() => jest.restoreAllMocks());

  const flushFrames = () => {
    while (frames.length) frames.shift()?.(0);
  };

  it("renders and clears a source without breadcrumb history", () => {
    const props = baseProps();
    const { container } = render(<SimilarTrailBar {...props} />);

    expect(
      screen.getByRole("img", { name: "Similarity search source (source photo.jpg)" }),
    ).toHaveAttribute("src", "/source.jpg");
    expect(screen.queryByLabelText("Similarity breadcrumbs")).toBeNull();
    expect(props.sourceRef.current).toBeInTheDocument();
    const source = screen.getByRole("button", { name: "Clear current similarity selection" });
    fireEvent.mouseEnter(source);
    expect(source.parentElement).toHaveStyle({ opacity: "0.15" });
    fireEvent.mouseLeave(source);
    fireEvent.click(source);
    expect(props.onTruncate).toHaveBeenCalledWith(0);

    const slideshow = screen.getByRole("link", { name: "Start similarity trail slideshow" });
    expect(slideshow).toHaveAttribute(
      "href",
      "/slideshow?mode=similar&seed=..%2Falbums%2Ftest-simple%2Fsource%20photo.jpg",
    );
    fireEvent.click(slideshow);
    expect(navigate).toHaveBeenCalledWith(expect.anything(), slideshow.getAttribute("href"));
    expect(container.textContent).not.toContain("→");
  });

  it("renders duplicate breadcrumb paths independently in reverse recency order", () => {
    const props = baseProps();
    props.trail = [
      { path: "../albums/one/first.jpg", similarity: 0.456 },
      { path: "../albums/one/first.jpg" },
      { path: "malformed" },
    ];
    render(<SimilarTrailBar {...props} />);
    flushFrames();

    expect(screen.getByLabelText("Similarity breadcrumbs")).toBeInTheDocument();
    expect(screen.getByText("46%")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "first.jpg" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "malformed" })).toHaveAttribute("href", "/search");
    expect(screen.getAllByRole("button", { name: /Remove first.jpg/ })).toHaveLength(2);
  });

  it("previews truncation and forwards breadcrumb and order choices", () => {
    const props = baseProps();
    props.trail = [
      { path: "../albums/one/old.jpg", similarity: 0.5 },
      { path: "../albums/one/new.jpg", similarity: 0.75 },
    ];
    const { container } = render(<SimilarTrailBar {...props} />);
    flushFrames();

    fireEvent.click(screen.getByRole("radio", { name: "Least similar" }));
    expect(props.onSetSimilarityOrder).toHaveBeenCalledWith("least");

    const removeOld = screen.getByRole("button", { name: "Remove old.jpg from breadcrumbs" });
    fireEvent.mouseEnter(removeOld);
    expect(container.querySelectorAll(".breadcrumbItemWillRemove")).toHaveLength(2);
    fireEvent.mouseLeave(removeOld);
    fireEvent.click(removeOld);
    expect(props.onTruncate).toHaveBeenCalledWith(0);
  });

  it("animates moved breadcrumbs but skips sub-pixel changes", () => {
    const props = baseProps();
    props.trail = [{ path: "../albums/one/photo.jpg" }];
    const view = render(<SimilarTrailBar {...props} />);
    flushFrames();

    left = 10.5;
    view.rerender(
      <SimilarTrailBar {...props} trail={[...props.trail, { path: "../albums/one/new.jpg" }]} />,
    );
    // The existing item moves less than a pixel; only the new item enters.
    expect(frames).toHaveLength(1);
    flushFrames();

    left = 30;
    view.rerender(
      <SimilarTrailBar
        {...props}
        trail={[
          ...props.trail,
          { path: "../albums/one/new.jpg" },
          { path: "../albums/one/latest.jpg" },
        ]}
      />,
    );
    expect(frames.length).toBeGreaterThan(0);
    flushFrames();
  });

  it("omits optional source metadata", () => {
    const view = render(
      <SimilarTrailBar {...baseProps()} similarPreviewSrc="/source.jpg" similarFilename={null} />,
    );
    expect(screen.getByRole("img", { name: "Similarity search source" })).toBeInTheDocument();
    expect(screen.queryByText("source photo.jpg")).toBeNull();
    view.rerender(
      <SimilarTrailBar {...baseProps()} similarPreviewSrc={null} similarFilename={null} />,
    );
    expect(screen.queryByRole("img")).toBeNull();
  });
});
