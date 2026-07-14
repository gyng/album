/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { Block, PhotoBlock, TextBlock, VideoBlock } from "../services/types";
import { BlockEl } from "./Block";

jest.mock("./Photo", () => ({
  PhotoBlockEl: ({ block, currentIndex }: { block: PhotoBlock; currentIndex: number }) => (
    <div>
      Photo {block.id} at {currentIndex}
    </div>
  ),
}));

jest.mock("./TextBlock", () => ({
  TextBlockEl: ({ block, currentIndex }: { block: TextBlock; currentIndex: number }) => (
    <div>
      Text {block.id} at {currentIndex}
    </div>
  ),
}));

describe("BlockEl", () => {
  it.each([
    [
      "photo",
      {
        kind: "photo",
        id: "harbour",
        data: { src: "harbour.jpg" },
        _build: {
          width: 100,
          height: 100,
          exif: {},
          tags: {},
          srcset: [{ src: "harbour.avif", width: 100, height: 100 }],
        },
      } as PhotoBlock,
      "Photo harbour at 4",
    ],
    [
      "text",
      { kind: "text", id: "intro", data: { title: "Introduction" } } as TextBlock,
      "Text intro at 4",
    ],
  ])("renders the %s block implementation", (_kind, block, expected) => {
    render(<BlockEl b={block} i={4} />);

    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("shows diagnostic content for an unsupported video block", () => {
    const block: VideoBlock = {
      kind: "video",
      id: "clip",
      data: { type: "local", href: "clip.mp4" },
    };

    render(<BlockEl b={block as Block} i={0} />);

    expect(screen.getByText(/Unsupported block/)).toHaveTextContent('"href": "clip.mp4"');
  });
});
