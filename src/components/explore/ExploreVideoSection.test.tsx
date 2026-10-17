/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { ExploreVideoSection } from "./ExploreVideoSection";
import type { ExploreClipRow } from "../../util/pageDataTypes";

const POSTER_SRC = "/data/albums/kansai/.resized_images/clip.mov@800.avif";

const baseClip = (overrides: Partial<ExploreClipRow> = {}): ExploreClipRow => ({
  id: "clip.mov",
  album: "kansai",
  href: "/album/kansai#clip.mov",
  src: { src: POSTER_SRC, width: 800, height: 450 },
  capturedAtLocal: "2024-05-01T09:00:00",
  year: 2024,
  label: "Kansai festival",
  ...overrides,
});

describe("ExploreVideoSection", () => {
  let playSpy: jest.SpyInstance;
  let pauseSpy: jest.SpyInstance;

  beforeEach(() => {
    // jsdom has no media pipeline; the hover preview's element.play() would
    // otherwise throw "Not implemented".
    playSpy = jest
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    pauseSpy = jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it("links each poster to its clip's album anchor and badges its duration", () => {
    render(<ExploreVideoSection clips={[{ ...baseClip(), durationSeconds: 13 }]} />);

    const poster = screen.getByAltText("Kansai festival");
    expect(poster).toHaveAttribute("src", POSTER_SRC);
    expect(poster.closest("a")).toHaveAttribute("href", "/album/kansai#clip.mov");
    // The same "Video, m:ss" vocabulary the search page's tiles use.
    expect(screen.getByLabelText("Video, 0:13")).toBeTruthy();
    // Album and capture date, read from the clip rather than the machine clock.
    expect(screen.getByText("kansai · 1 May 2024")).toBeTruthy();
  });

  it("omits the badge for a clip with no duration", () => {
    render(<ExploreVideoSection clips={[baseClip()]} />);

    expect(screen.getByAltText("Kansai festival").closest("a")).toHaveAttribute(
      "href",
      "/album/kansai#clip.mov",
    );
    expect(screen.queryByLabelText(/^Video, /)).toBeNull();
  });

  it("renders nothing when the archive has no clips", () => {
    const { container } = render(<ExploreVideoSection clips={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Every tile here is a local clip, so pointing at its poster plays the clip
  // in place. The poster itself is untouched; the video is an overlay.
  it("plays the clip over its poster on hover, leaving the poster and badge alone", () => {
    const { container } = render(
      <ExploreVideoSection clips={[{ ...baseClip(), durationSeconds: 13 }]} />,
    );

    expect(container.querySelector("video")).toBeNull();

    const poster = screen.getByAltText("Kansai festival");
    // React derives onPointerEnter from the bubbling pointerover event.
    fireEvent.pointerOver(poster.parentElement!);

    const video = container.querySelector<HTMLVideoElement>("video");
    if (!video) throw new Error("video element not rendered");
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(video).toHaveAttribute("src", "/data/albums/kansai/.resized_videos/clip.mov%401920.mp4");
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("aria-hidden", "true");
    expect(video.muted).toBe(true);
    expect(playSpy).toHaveBeenCalled();

    // The poster is the same element, still inside the same link, and the
    // duration badge and caption are unchanged.
    expect(screen.getByAltText("Kansai festival")).toBe(poster);
    expect(poster).toHaveAttribute("src", POSTER_SRC);
    expect(poster.closest("a")).toHaveAttribute("href", "/album/kansai#clip.mov");
    expect(screen.getByLabelText("Video, 0:13")).toBeTruthy();
    expect(screen.getByText("kansai · 1 May 2024")).toBeTruthy();
  });
});
