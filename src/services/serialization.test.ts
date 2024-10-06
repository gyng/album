/**
 * @jest-environment node
 */

import { deserializeContentBlock } from "./deserialize";
import { serializeContentBlock } from "./serialize";
import { Content, SerializedContent } from "./types";

describe("serialization", () => {
  const content: Content = {
    name: "foo",
    title: "bar",
    blocks: [
      {
        kind: "photo",
        id: "foo",
        data: {
          src: "test/fixtures/monkey.jpg",
        },
        _build: {
          height: 100,
          width: 100,
          exif: {},
          tags: {},
          srcset: [
            { src: "monkey.optimised.jpg", width: 100, height: 150 },
            { src: "monkey.optimised.2.jpg", width: 100, height: 150 },
          ],
        },
      },
    ],
    formatting: {
      overlay: undefined,
    },
    _build: {
      slug: "slug",
      timeRange: [0, 1000],
      srcdir: "srcdir",
    },
  };

  const serializedContent: SerializedContent = {
    blocks: [
      {
        data: { src: "test/fixtures/monkey.jpg" },
        id: "foo",
        kind: "photo",
      },
    ],
    name: "foo",
    title: "bar",
    formatting: {
      overlay: undefined,
    },
  };

  const fullyDeserializedContent: Content = {
    blocks: [
      {
        data: { src: "/fixtures/monkey.jpg" },
        id: "foo",
        kind: "photo",
        formatting: { cover: false },
        _build: {
          srcset: [
            {
              src: "/data/albums/fixtures/.resized_images/monkey.jpg@800.avif",
              width: 800,
              height: 1176,
            },
            {
              src: "/data/albums/fixtures/.resized_images/monkey.jpg@1600.avif",
              width: 1600,
              height: 2353,
            },
            {
              src: "/data/albums/fixtures/.resized_images/monkey.jpg@3200.avif",
              width: 3200,
              height: 4706,
            },
          ],
          exif: {},
          tags: null,
          width: 34,
          height: 50,
        },
      },
    ],
    name: "foo",
    title: "bar",
    formatting: { overlay: undefined },
    _build: { slug: "foo", srcdir: "." },
  };

  it("serializes a Content object", () => {
    const input: Content = content;
    const actual = serializeContentBlock(input);
    const expected: SerializedContent = serializedContent;
    expect(actual).toEqual(expected);
  });

  it("deserializes a SerializedContent object", async () => {
    const input: SerializedContent = serializedContent;
    const actual = await deserializeContentBlock(input, ".");
    // @ts-expect-error forced delete
    actual.blocks[0]._build.exif = {};

    const expected: Content = fullyDeserializedContent;
    expect(actual).toEqual(expected);
    // First run will optimise images: avif optimisation takes a while
    // We keep optimised images in .resized_iamges
  }, 60000);
});
