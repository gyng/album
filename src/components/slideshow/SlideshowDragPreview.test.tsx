/** @jest-environment jsdom */
import { render, waitFor } from "@testing-library/react";
import { SlideshowDragPreview } from "./SlideshowDragPreview";

describe("slideshow neighbour buffers", () => {
  it("decodes neighbours before dragging, without decoding again on movement", async () => {
    const decoded: string[] = [];
    const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");
    HTMLImageElement.prototype.decode = function () {
      decoded.push(this.getAttribute("src")!);
      return Promise.resolve();
    };
    try {
      const props = {
        nextSrc: "/next.avif",
        previousSrc: "/previous.avif",
        settling: false,
        cover: false,
      };
      const { container, rerender } = render(<SlideshowDragPreview {...props} peek={undefined} />);
      await waitFor(() => expect(decoded).toEqual(["/next.avif", "/previous.avif"]));
      const images = Array.from(container.querySelectorAll("img"));
      for (let move = 0; move < 3; move += 1) {
        rerender(<SlideshowDragPreview {...props} peek={{ src: "/next.avif", direction: 1 }} />);
      }
      rerender(<SlideshowDragPreview {...props} peek={{ src: "/previous.avif", direction: -1 }} />);
      expect(Array.from(container.querySelectorAll("img"))).toEqual(images);
      expect(decoded).toHaveLength(2);
    } finally {
      if (original) Object.defineProperty(HTMLImageElement.prototype, "decode", original);
      else Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
    }
  });

  it("preserves the outgoing preview until settling ends when the queue advances", () => {
    const props = { previousSrc: null, cover: false };
    const peek = { src: "/next.avif", direction: 1 };
    const { container, rerender } = render(
      <SlideshowDragPreview {...props} nextSrc="/next.avif" peek={peek} settling={false} />,
    );
    const image = container.querySelector("img");
    rerender(<SlideshowDragPreview {...props} nextSrc="/later.avif" peek={peek} settling />);
    expect(container.querySelector("img")).toBe(image);
    expect(image).toHaveAttribute("src", "/next.avif");
    rerender(
      <SlideshowDragPreview {...props} nextSrc="/later.avif" peek={undefined} settling={false} />,
    );
    expect(container.querySelector("img")).toBe(image);
    expect(image).toHaveAttribute("src", "/later.avif");
    expect(image).not.toHaveAttribute("data-drag-peek");
  });
});
