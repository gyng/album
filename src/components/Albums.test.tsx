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

const video = (id: string): VideoBlock => ({
  kind: "video",
  id,
  data: { type: "local", href: id },
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
