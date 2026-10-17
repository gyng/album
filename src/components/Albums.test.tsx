/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Content, PhotoBlock, TextBlock, VideoBlock } from "../services/types";
import { Albums } from "./Albums";
import { resetPrefetchedImages } from "../util/prefetchImage";

jest.mock("./Photo", () => ({
  Picture: ({ block, label, lazy }: { block: PhotoBlock; label: string; lazy: boolean }) => (
    <img src={block.data.src} alt={label} loading={lazy ? "lazy" : "eager"} />
  ),
}));

const photo = (id: string, cover = false): PhotoBlock => ({
  kind: "photo",
  id,
  data: { src: `${id}.jpg` },
  ...(cover ? { formatting: { cover: true } } : {}),
  _build: {
    width: 100,
    height: 100,
    exif: {},
    tags: {},
    srcset: [{ src: `${id}.avif`, width: 100, height: 100 }],
  },
});

const text = (id: string): TextBlock => ({
  kind: "text",
  id,
  data: { title: "Introduction" },
});

const video = (id: string, type: "local" | "youtube" = "local"): VideoBlock => ({
  kind: "video",
  id,
  data: type === "local" ? { type: "local", href: id } : { type: "youtube", href: id },
  _build: {
    src: `${id}@1920.mp4`,
    mimeType: "video/mp4",
    poster: { srcset: [{ src: `${id}.avif`, width: 100, height: 100 }] },
    capturedAtLocal: "2024-05-01T09:00:00",
  },
});

const album = (
  slug: string,
  options: {
    blocks?: Content["blocks"];
    timeRange?: Content["_build"]["timeRange"];
    title?: string;
    sort?: Content["formatting"]["sort"];
  } = {},
): Content => ({
  name: slug,
  title: options.title ?? `Album ${slug}`,
  blocks: options.blocks ?? [photo(`${slug}-first`)],
  formatting: options.sort ? { sort: options.sort } : {},
  _build: {
    slug,
    srcdir: `/albums/${slug}`,
    ...(options.timeRange ? { timeRange: options.timeRange } : {}),
  },
});

describe("Albums", () => {
  let playSpy: jest.SpyInstance;
  let pauseSpy: jest.SpyInstance;

  beforeEach(() => {
    // jsdom has no media pipeline; a cover's preview play() would otherwise
    // throw "Not implemented".
    playSpy = jest
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    pauseSpy = jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it("shows newest-first album years in descending order", () => {
    render(
      <Albums
        albums={[
          album("recent", {
            sort: "newest-first",
            timeRange: ["2011-01-01T00:00:00", "2026-10-12T00:00:00"],
          }),
        ]}
      />,
    );
    expect(screen.getByText("2026–2011 · 1 snap")).toBeTruthy();
  });

  it("links album covers and prefers the photo explicitly marked as the cover", () => {
    render(
      <Albums
        albums={[
          album("featured", {
            title: "Featured journey",
            blocks: [text("intro"), photo("first"), photo("chosen", true)],
            timeRange: ["2022-01-02T03:04:05", "2024-06-07T08:09:10"],
          }),
        ]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "View photo album: Featured journey" }),
    ).toHaveAttribute("href", "/album/featured");
    expect(screen.getByRole("img", { name: "Album cover for featured" })).toHaveAttribute(
      "src",
      "chosen.jpg",
    );
    expect(screen.getByText("2022–2024 · 2 snaps")).toBeTruthy();
  });

  it("shows single-year, missing, and malformed date ranges without inventing dates", () => {
    render(
      <Albums
        albums={[
          album("same-year", {
            timeRange: ["2023-01-01T00:00:00", "2023-12-31T23:59:59"],
          }),
          album("one-date", { timeRange: ["2021-05-06T07:08:09", null] }),
          album("no-date", { timeRange: [null, null] }),
          album("bad-date", { timeRange: ["not-a-date", "also-not-a-date"] }),
        ]}
      />,
    );

    expect(screen.getByText("2023 · 1 snap")).toBeTruthy();
    expect(screen.getByText("2021 · 1 snap")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("omits a cover for albums without photos and eagerly loads only the first actual cover", () => {
    const albums = Array.from({ length: 8 }, (_, index) => album(`album-${index}`));
    albums[0] = album("text-only", { blocks: [text("only-text")] });

    render(<Albums albums={albums} />);

    expect(screen.queryByRole("img", { name: "Album cover for text-only" })).toBeNull();
    expect(screen.getByRole("img", { name: "Album cover for album-1" })).toHaveAttribute(
      "loading",
      "eager",
    );
    expect(screen.getByRole("img", { name: "Album cover for album-2" })).toHaveAttribute(
      "loading",
      "lazy",
    );
    expect(screen.getByRole("img", { name: "Album cover for album-7" })).toHaveAttribute(
      "loading",
      "lazy",
    );
  });

  // A clip is media on a card too: its poster frame is the cover and it is
  // counted, so an album of clips alone is not an album with nothing in it.
  it("draws a clip's poster frame as the cover and counts the clip", () => {
    render(<Albums albums={[album("clips", { blocks: [video("sunset.mov")] })]} />);

    expect(screen.getByRole("img", { name: "Album cover for clips" })).toHaveAttribute(
      "src",
      "sunset.mov",
    );
    expect(screen.getByText("1 snap")).toBeTruthy();
  });

  // A clip's cover is its poster frame, so pointing at the card plays the clip
  // itself — the file the transcoder wrote into the album's own cache.
  it("plays a local clip's file over its cover on hover", () => {
    const { container } = render(
      <Albums albums={[album("clips", { blocks: [video("sunset.mov")] })]} />,
    );

    // Nothing is fetched or decoded before a pointer arrives.
    expect(container.querySelector("video")).toBeNull();

    const cover = screen.getByRole("img", { name: "Album cover for clips" });
    // React derives onPointerEnter from the bubbling pointerover event; a
    // native pointerenter never reaches its listeners.
    fireEvent.pointerOver(cover.parentElement!);

    expect(container.querySelectorAll("video")).toHaveLength(1);
    const preview = container.querySelector<HTMLVideoElement>("video");
    if (!preview) throw new Error("video element not rendered");
    expect(preview).toHaveAttribute(
      "src",
      "/data/albums/clips/.resized_videos/sunset.mov%401920.mp4",
    );
    expect(preview).toHaveAttribute("preload", "none");
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(preview.muted).toBe(true);
    expect(preview.loop).toBe(true);
    expect(playSpy).toHaveBeenCalled();

    // The cover is still the element it was, in the same link.
    expect(screen.getByRole("img", { name: "Album cover for clips" })).toBe(cover);
    expect(cover.closest("a")).toHaveAttribute("href", "/album/clips");

    // Leaving pauses; the element stays mounted, so a second hover plays that
    // same one rather than fetching a second.
    fireEvent.pointerOut(cover.parentElement!);
    expect(pauseSpy).toHaveBeenCalled();
    const playsBefore = playSpy.mock.calls.length;
    fireEvent.pointerOver(cover.parentElement!);
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(playSpy.mock.calls.length).toBeGreaterThan(playsBefore);
  });

  // A photograph is not a clip: its cover keeps the poster it already had.
  it("mounts no preview over a photograph's cover", () => {
    const { container } = render(<Albums albums={[album("stills")]} />);

    const cover = screen.getByRole("img", { name: "Album cover for stills" });
    fireEvent.pointerOver(cover.parentElement!);

    expect(container.querySelector("video")).toBeNull();
    // Nothing was wrapped: the card's own link is still the cover's parent.
    expect(cover.parentElement?.tagName).toBe("A");
  });

  // A YouTube external's cover is a poster frame like a clip's, but there is no
  // transcoded MP4 behind it, so it must stay a poster.
  it("mounts no preview over a YouTube external's cover", () => {
    const external = video("ycyUWULJxdU.youtube", "youtube");
    const { container } = render(<Albums albums={[album("externals", { blocks: [external] })]} />);

    const cover = screen.getByRole("img", { name: "Album cover for externals" });
    fireEvent.pointerOver(cover.parentElement!);

    expect(container.querySelector("video")).toBeNull();
    expect(cover.parentElement?.tagName).toBe("A");
  });

  // The router prefetches the page; nothing prefetched the photograph the page
  // is for, so the album's largest image began loading after the navigation.
  it("fetches an album's first photograph once the pointer has stayed", () => {
    jest.useFakeTimers();
    resetPrefetchedImages();
    const made: HTMLImageElement[] = [];
    const RealImage = globalThis.Image;
    globalThis.Image = class extends RealImage {
      constructor() {
        super();
        made.push(this as unknown as HTMLImageElement);
      }
    } as unknown as typeof Image;

    render(<Albums albums={[album("kyoto")]} />);
    const link = screen.getByLabelText("View photo album: Album kyoto");

    // A pointer passing through fetches nothing.
    fireEvent.pointerEnter(link);
    fireEvent.pointerLeave(link);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(made).toHaveLength(0);

    fireEvent.pointerEnter(link);
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(made).toHaveLength(1);
    // The album page's own sizes for that image, so the browser picks the same
    // candidate it is about to ask for.
    expect(made[0]?.sizes).toBe("auto, 100vw");
    globalThis.Image = RealImage;
    jest.useRealTimers();
  });
});
