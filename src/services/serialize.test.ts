/**
 * @jest-environment node
 */

import {
  serializeBlock,
  serializeContentBlock,
  serializePhotoBlock,
  serializeTextBlock,
  serializeVideoBlock,
} from "./serialize";
import type { Content, PhotoBlock, TextBlock, VideoBlock } from "./types";

const photo = (formatting?: PhotoBlock["formatting"]): PhotoBlock => ({
  kind: "photo",
  id: "photo.jpg",
  data: { src: "photo.jpg" },
  ...(formatting === undefined ? {} : { formatting }),
  _build: { width: 100, height: 80, exif: {}, tags: {}, srcset: [] },
});

const text = (formatting?: TextBlock["formatting"]): TextBlock => ({
  kind: "text",
  id: "intro",
  data: { title: "Introduction" },
  ...(formatting === undefined ? {} : { formatting }),
});

const video: VideoBlock = {
  kind: "video",
  id: "clip",
  data: { type: "youtube", href: "https://www.youtube.com/embed/clip" },
};

describe("album serialisation", () => {
  it("omits absent and false-only photo formatting without mutating the source", () => {
    expect(serializePhotoBlock(photo())).not.toHaveProperty("formatting");

    const source = photo({ immersive: false });
    expect(serializePhotoBlock(source)).not.toHaveProperty("formatting");
    expect(source.formatting).toEqual({ immersive: false });
  });

  it("retains meaningful photo formatting", () => {
    expect(serializePhotoBlock(photo({ immersive: true, cover: true }))).toMatchObject({
      formatting: { immersive: true, cover: true },
    });
  });

  it("omits empty text formatting without mutating the source", () => {
    const source = text({});

    expect(serializeTextBlock(source)).not.toHaveProperty("formatting");
    expect(source).toHaveProperty("formatting", {});
  });

  it("preserves meaningful text and video blocks", () => {
    const formatted = text({ align: "centre" } as never);

    expect(serializeTextBlock(formatted)).toEqual(formatted);
    expect(serializeVideoBlock(video)).toEqual(video);
  });

  it("serialises every supported block in content and removes build metadata", () => {
    const content: Content = {
      name: "trip",
      title: "Trip",
      blocks: [photo({ cover: true }), text(), video],
      formatting: {},
      _build: { slug: "trip", srcdir: "../albums/trip" },
    };

    const result = serializeContentBlock(content);

    expect(result).not.toHaveProperty("_build");
    expect(result.blocks.map(({ kind }) => kind)).toEqual(["photo", "text", "video"]);
    expect(content).toHaveProperty("_build.slug", "trip");
  });

  it("rejects unsupported block kinds", () => {
    expect(() => serializeBlock({ kind: "audio" } as never)).toThrow(
      "serializeBlock: Unsupported block audio",
    );
  });
});
