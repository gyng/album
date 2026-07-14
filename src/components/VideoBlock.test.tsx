/**
 * @jest-environment jsdom
 */

import { act } from "react";
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
    expect(screen.getByText("Permalink")).toHaveAttribute("href", "#video-youtube-1");
    expect(screen.getByText("License")).toBeTruthy();
  });

  it("falls back to the source URL when a video has no explicit permalink ID", () => {
    render(<YoutubeBlockEl src="https://www.youtube.com/embed/fallback" />);

    expect(screen.getByText("Permalink")).toHaveAttribute(
      "href",
      "#https://www.youtube.com/embed/fallback",
    );
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

describe("LocalVideoBlockEl viewport auto-play", () => {
  let observerCallback: IntersectionObserverCallback;
  let playSpy: jest.SpyInstance;
  let pauseSpy: jest.SpyInstance;
  const originalIntersectionObserver = global.IntersectionObserver;

  beforeEach(() => {
    class MockIntersectionObserver {
      constructor(cb: IntersectionObserverCallback) {
        observerCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    global.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;

    playSpy = jest
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    pauseSpy = jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    global.IntersectionObserver = originalIntersectionObserver;
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  const triggerIntersect = (isIntersecting: boolean, target: Element) => {
    act(() => {
      observerCallback(
        [{ isIntersecting, target } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
  };

  it("does not auto-resume a video the viewer paused when it re-enters view", () => {
    render(<LocalVideoBlockEl id="v1" src="/clip.mp4" />);
    const video = document.querySelector("video");
    if (!video) throw new Error("video element not rendered");

    triggerIntersect(true, video);
    expect(playSpy).toHaveBeenCalledTimes(1);

    // Viewer pauses while the video is on-screen.
    act(() => {
      video.dispatchEvent(new Event("pause"));
    });

    // Scroll away and back — the observer must respect the manual pause.
    triggerIntersect(false, video);
    triggerIntersect(true, video);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("resumes viewport auto-play once the viewer manually plays again", () => {
    render(<LocalVideoBlockEl id="v2" src="/clip.mp4" />);
    const video = document.querySelector("video");
    if (!video) throw new Error("video element not rendered");

    triggerIntersect(true, video);
    act(() => {
      video.dispatchEvent(new Event("pause"));
    });
    triggerIntersect(true, video);
    expect(playSpy).toHaveBeenCalledTimes(1);

    // Viewer presses play — clears the manual-pause latch.
    act(() => {
      video.dispatchEvent(new Event("play"));
    });
    triggerIntersect(false, video);
    triggerIntersect(true, video);
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it("ignores empty observer batches and treats off-screen pauses as automatic", () => {
    render(<LocalVideoBlockEl id="v3" src="/clip.mp4" />);
    const video = document.querySelector("video");
    if (!video) throw new Error("video element not rendered");

    act(() => {
      observerCallback([], {} as IntersectionObserver);
    });
    expect(playSpy).not.toHaveBeenCalled();

    triggerIntersect(false, video);
    act(() => {
      video.dispatchEvent(new Event("pause"));
    });
    triggerIntersect(true, video);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("tolerates browsers rejecting viewport autoplay", async () => {
    playSpy.mockRejectedValueOnce(new Error("Autoplay blocked"));
    render(<LocalVideoBlockEl id="v4" src="/clip.mp4" />);
    const video = document.querySelector("video");
    if (!video) throw new Error("video element not rendered");

    triggerIntersect(true, video);
    await act(async () => {
      await Promise.resolve();
    });

    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});
