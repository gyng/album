/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
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
});
