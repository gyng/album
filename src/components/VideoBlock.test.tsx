/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { LocalVideoBlockEl, YoutubeBlockEl } from "./VideoBlock";

describe("VideoBlock", () => {
  it("renders details panel for YouTube videos", () => {
    render(
      <YoutubeBlockEl
        id="video-youtube-1"
        src="https://www.youtube.com/embed/9bw3IL444Uo"
        date="2025-11-25"
      />,
    );

    fireEvent.click(screen.getByTitle("More details…"));

    expect(screen.getAllByTestId("videoblockel")).toHaveLength(1);
    expect(screen.getByText("Type")).toBeTruthy();
    expect(screen.getByText("youtube")).toBeTruthy();
    expect(screen.getByText("Technical profile")).toBeTruthy();
    expect(screen.getByText("YouTube adaptive stream")).toBeTruthy();
    expect(screen.getByText("Date")).toBeTruthy();
    expect(screen.getByText("2025-11-25")).toBeTruthy();
    expect(screen.queryByText("Source")).toBeNull();
    expect(screen.getByText("Permalink")).toBeTruthy();
    expect(screen.getByText("License")).toBeTruthy();
  });

  it("renders details panel for local videos", () => {
    render(
      <LocalVideoBlockEl
        id="video-local-1"
        src="/data/albums/foo/.resized_videos/clip.mp4@1920.mp4"
        originalSrc="DSCF0159.MOV"
        date="2026-01-02"
        mimeType="video/mp4"
        originalTechnicalData={{
          originalDate: "2023-11-20T10:11:12.000Z",
          codec: "h264",
          profile: "High",
          fps: 59.94,
          bitrateKbps: 24000,
          fileSizeBytes: 10485760,
          durationSeconds: 10.5,
          width: 3840,
          height: 2160,
          audioCodec: "aac",
          container: "mov,mp4,m4a,3gp,3g2,mj2",
        }}
      />,
    );

    fireEvent.click(screen.getByTitle("More details…"));

    expect(screen.getAllByTestId("videoblockel")).toHaveLength(1);
    expect(screen.getByText("local")).toBeTruthy();
    expect(screen.getByText("Playback MIME")).toBeTruthy();
    expect(screen.getByText("video/mp4")).toBeTruthy();
    expect(screen.getByText("Max width")).toBeTruthy();
    expect(screen.getByText("1920px")).toBeTruthy();
    expect(screen.getByText("Original file")).toBeTruthy();
    expect(screen.getByText("DSCF0159.MOV")).toBeTruthy();
    expect(screen.getByText("Original date")).toBeTruthy();
    expect(screen.getByText("2023-11-20T10:11:12.000Z")).toBeTruthy();
    expect(screen.getByText("Codec")).toBeTruthy();
    expect(screen.getByText("h264")).toBeTruthy();
    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("Framerate")).toBeTruthy();
    expect(screen.getByText("59.94 fps")).toBeTruthy();
    expect(screen.getByText("Original container")).toBeTruthy();
    expect(screen.getByText("mov,mp4,m4a,3gp,3g2,mj2")).toBeTruthy();
    expect(screen.getByText("File size")).toBeTruthy();
    expect(screen.getByText("10.00 MB")).toBeTruthy();
    expect(screen.queryByText("Source")).toBeNull();
    expect(screen.getByText("2026-01-02")).toBeTruthy();
  });
});
