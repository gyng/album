import { monkeyExif } from "../test/fixtures/monkey_exif";
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
          srcset: [
            { src: "monkey.optimised.jpg", width: 100 },
            { src: "monkey.optimised.2.jpg", width: 100 },
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
              src: "/fixtures/.resized_images/monkey.jpg@800.webp",
              width: 800,
            },
            {
              src: "/fixtures/.resized_images/monkey.jpg@1200.webp",
              width: 1200,
            },
            {
              src: "/fixtures/.resized_images/monkey.jpg@2400.webp",
              width: 2400,
            },
            {
              src: "/fixtures/.resized_images/monkey.jpg@4896.webp",
              width: 4896,
            },
          ],
          exif: monkeyExif,
          width: 34,
          height: 50,
        },
      },
    ],
    name: "foo",
    title: "bar",
    formatting: {},
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
    const expected: Content = fullyDeserializedContent;
    expect(actual).toEqual(expected);
    // First run will optimise images: webp optimisation takes a while
    // We keep optimised images in .resized_iamges
  }, 10000);
});
