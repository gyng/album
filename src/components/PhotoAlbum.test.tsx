/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { Content, IBlock, PhotoBlock, TextBlock } from "../services/types";
import { Block, PhotoAlbum } from "./PhotoAlbum";

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

jest.mock("./VideoBlock", () => ({
  YoutubeBlockEl: ({ id, src, date }: { id: string; src: string; date?: string }) => (
    <div>
      YouTube {id} {src} {date}
    </div>
  ),
  LocalVideoBlockEl: ({
    id,
    src,
    originalSrc,
    mimeType,
  }: {
    id: string;
    src: string;
    originalSrc?: string;
    mimeType?: string;
  }) => (
    <div>
      Local {id} {src} {originalSrc} {mimeType}
    </div>
  ),
}));

const photo: PhotoBlock = {
  kind: "photo",
  id: "photo-one",
  data: { src: "photo.jpg" },
  _build: {
    width: 100,
    height: 100,
    exif: {},
    tags: {},
    srcset: [{ src: "photo.avif", width: 100, height: 100 }],
  },
};

const text: TextBlock = {
  kind: "text",
  id: "text-one",
  data: { title: "Introduction" },
};

describe("PhotoAlbum block rendering", () => {
  it("dispatches photo, text, YouTube, and local-video blocks with their positions", () => {
    const album: Content = {
      name: "journey",
      title: "Journey",
      formatting: {},
      blocks: [
        photo,
        text,
        {
          kind: "video",
          id: "youtube-one",
          data: { type: "youtube", href: "https://youtube.example/embed/one", date: "2024-01-02" },
        },
        {
          kind: "video",
          id: "local-one",
          data: { type: "local", href: "/clip.mp4" },
          _build: {
            src: "/clip.mp4",
            originalSrc: "clip.mov",
            mimeType: "video/mp4",
          },
        },
      ],
      _build: { slug: "journey", srcdir: "/albums/journey" },
    };

    render(<PhotoAlbum album={album} />);

    expect(screen.getByText("Photo photo-one at 0")).toBeTruthy();
    expect(screen.getByText("Text text-one at 1")).toBeTruthy();
    expect(
      screen.getByText("YouTube youtube-one https://youtube.example/embed/one 2024-01-02"),
    ).toBeTruthy();
    expect(screen.getByText("Local local-one /clip.mp4 clip.mov video/mp4")).toBeTruthy();
  });

  it("shows diagnostic output for unsupported block and video variants", () => {
    const unsupportedVideo = {
      kind: "video",
      id: "future-video",
      data: { type: "future", href: "/future.video" },
    } as unknown as IBlock;
    const unsupportedBlock = {
      kind: "panorama",
      id: "future-block",
      data: { src: "/panorama.jpg" },
    } as IBlock;
    const { rerender } = render(<Block b={unsupportedVideo} i={0} />);

    expect(screen.getByText(/Unsupported video type/)).toHaveTextContent('"type": "future"');

    rerender(<Block b={unsupportedBlock} i={0} />);
    expect(screen.getByText(/Unsupported block/)).toHaveTextContent('"kind": "panorama"');
  });
});
