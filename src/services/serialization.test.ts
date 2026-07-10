/**
 * @jest-environment node
 */

import { deserializeContentBlock, deserializeInternals } from "./deserialize";
import { serializeContentBlock, serializePhotoBlock } from "./serialize";
import { getOriginalVideoTechnicalData } from "./video";
import { Content, PhotoBlock, SerializedContent } from "./types";

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
      timeRange: ["2024-01-01T00:00:00", "2024-01-02T00:00:00"],
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
          tags: null as any,
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

  it("serialises a local video block cleanly when date/bitrate metadata is missing", async () => {
    // ffprobe found no creation_time / bit_rate: the mapper returns a partial
    // object with those keys omitted (H5).
    (getOriginalVideoTechnicalData as jest.Mock).mockResolvedValueOnce({
      codec: "h264",
      width: 1280,
      height: 720,
    });

    const input: SerializedContent = {
      name: "foo",
      title: "bar",
      formatting: {},
      blocks: [
        {
          kind: "video",
          id: "video-local-bare",
          data: { type: "local", href: "test/fixtures/clip.mp4" },
        },
      ],
    };

    const actual = await deserializeContentBlock(input, ".");
    const block = actual.blocks[0];

    // The `date` key is omitted entirely (not `date: undefined`).
    expect(block.kind).toBe("video");
    expect("date" in (block as any).data).toBe(false);

    // No `undefined` anywhere in the props tree (Next SSG guard), and a JSON
    // round-trip is lossless.
    const hasUndefined = (value: unknown): boolean =>
      Array.isArray(value)
        ? value.some(hasUndefined)
        : value !== null && typeof value === "object"
          ? Object.values(value as Record<string, unknown>).some(hasUndefined)
          : value === undefined;

    expect(hasUndefined(actual)).toBe(false);
    expect(JSON.parse(JSON.stringify(actual))).toEqual(actual);
  });

  it("serializePhotoBlock does not mutate its input", () => {
    const source: PhotoBlock = {
      kind: "photo",
      id: "p1",
      data: { src: "a.jpg" },
      formatting: { immersive: false, cover: true },
      _build: {
        height: 1,
        width: 1,
        exif: {},
        tags: {},
        srcset: [],
      },
    };
    const before = JSON.parse(JSON.stringify(source));

    const serialized = serializePhotoBlock(source);

    // Source is untouched: formatting still has both keys, _build intact.
    expect(source).toEqual(before);
    // Output drops the falsy `immersive` and the build-only fields.
    expect(serialized).toEqual({
      kind: "photo",
      id: "p1",
      data: { src: "a.jpg" },
      formatting: { cover: true },
    });
  });

  it("skips missing local photo blocks instead of throwing", async () => {
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const input: SerializedContent = {
      ...serializedContent,
      blocks: [
        {
          kind: "photo",
          id: "missing-photo",
          data: {
            src: "test/fixtures/does-not-exist.jpg",
          },
        },
        serializedContent.blocks[0],
      ],
    };

    const actual = await deserializeContentBlock(input, ".");

    expect(actual.blocks).toHaveLength(1);
    expect(actual.blocks[0]?.kind).toBe("photo");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Skipping missing media file: test/fixtures/does-not-exist.jpg",
    );

    consoleWarnSpy.mockRestore();
  });
});
