/**
 * @jest-environment node
 */

import { deserializeContentBlock, deserializeInternals } from "./deserialize";
import { serializeContentBlock } from "./serialize";
import { Content, SerializedContent } from "./types";

jest.mock("./video", () => ({
  optimiseVideo: jest.fn(async () => ({
    src: "/data/albums/fixtures/.resized_videos/clip.mp4@1920.mp4",
    mimeType: "video/mp4",
  })),
  getOriginalVideoTechnicalData: jest.fn(async () => ({
    originalDate: "2023-11-20T10:11:12.000Z",
    codec: "h264",
    profile: "High",
    fps: 29.97,
    bitrateKbps: 12000,
    fileSizeBytes: 34567890,
    durationSeconds: 12.345,
    width: 3840,
    height: 2160,
    audioCodec: "aac",
    container: "mov,mp4,m4a,3gp,3g2,mj2",
  })),
}));

describe("serialization", () => {
  afterEach(async () => {
    await deserializeInternals.resetForTesting();
  });

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
      {
        kind: "video",
        id: "video-local",
        data: {
          type: "local",
          href: "test/fixtures/clip.mp4",
          date: "2024-01-01",
        },
      },
      {
        kind: "video",
        id: "video-youtube",
        data: {
          type: "youtube",
          href: "https://www.youtube.com/embed/9bw3IL444Uo",
          date: "2024-01-02",
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
      {
        data: {
          type: "local",
          href: "test/fixtures/clip.mp4",
          date: "2024-01-01",
        },
        id: "video-local",
        kind: "video",
      },
      {
        data: {
          type: "youtube",
          href: "https://www.youtube.com/embed/9bw3IL444Uo",
          date: "2024-01-02",
        },
        id: "video-youtube",
        kind: "video",
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
      {
        data: {
          type: "local",
          href: "/data/albums/fixtures/.resized_videos/clip.mp4@1920.mp4",
          date: "2024-01-01",
        },
        id: "video-local",
        kind: "video",
        _build: {
          src: "/data/albums/fixtures/.resized_videos/clip.mp4@1920.mp4",
          originalSrc: "test/fixtures/clip.mp4",
          mimeType: "video/mp4",
          originalTechnicalData: {
            originalDate: "2023-11-20T10:11:12.000Z",
            codec: "h264",
            profile: "High",
            fps: 29.97,
            bitrateKbps: 12000,
            fileSizeBytes: 34567890,
            durationSeconds: 12.345,
            width: 3840,
            height: 2160,
            audioCodec: "aac",
            container: "mov,mp4,m4a,3gp,3g2,mj2",
          },
        },
      },
      {
        data: {
          type: "youtube",
          href: "https://www.youtube.com/embed/9bw3IL444Uo",
          date: "2024-01-02",
        },
        id: "video-youtube",
        kind: "video",
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

  it("falls back to original video date when local video date is missing", async () => {
    const input: SerializedContent = {
      ...serializedContent,
      blocks: [
        serializedContent.blocks[0],
        {
          kind: "video",
          id: "video-local-no-date",
          data: {
            type: "local",
            href: "test/fixtures/clip.mp4",
          },
        },
      ],
    };

    const actual = await deserializeContentBlock(input, ".");
    const localVideo = actual.blocks[1];

    expect(localVideo.kind).toBe("video");
    expect((localVideo as any).data.date).toBe("2023-11-20T10:11:12.000Z");
  });
});
