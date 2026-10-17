/**
 * @jest-environment jsdom
 */

import { act } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LocalVideoBlockEl, YoutubeBlockEl } from "./VideoBlock";
import { weatherFixture } from "../test/fixtures/weather";

jest.mock("./MapDeferred", () => ({
  MapDeferred: ({ coordinates }: { coordinates: [number, number] }) => (
    <div data-testid="clip-map">{coordinates.map((value) => value.toFixed(4)).join(",")}</div>
  ),
}));

jest.mock("./PhotoSimilarPhotosDeferred", () => ({
  PhotoSimilarPhotosDeferred: ({ path }: { path?: string }) => <p>Similar to {path}</p>,
}));

describe("VideoBlock", () => {
  it("renders details panel for YouTube videos", () => {
    render(
      <YoutubeBlockEl
        id="video-youtube-1"
        src="https://www.youtube.com/embed/9bw3IL444Uo"
        date="2025-11-25"
      />,
    );

    fireEvent.click(screen.getByLabelText("Video details"));

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

    fireEvent.click(screen.getByLabelText("Video details"));

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

// The details pane used to describe only the encoding — codec, bitrate, MIME
// type — and none of what a reader opens it for. A clip knows when and where it
// was shot, its camera, and everything the index says about its frame, so its
// pane says so, the way a photograph's does.
describe("LocalVideoBlockEl details", () => {
  const reading = {
    capturedAtLocal: "2025-12-01T20:15:51",
    latDeg: 35.6601711,
    lngDeg: 139.7292303,
    durationSeconds: 7.2,
    camera: {
      Make: "FUJIFILM",
      Model: "X-T5",
      LensInfo: [23, 23, 1.4, 1.4],
      FNumber: 1.4,
      ISO: 4000,
      ExposureTime: 1 / 30,
      FocalLength: 23,
    },
    tags: {
      path: "../albums/2511japan/DSCF7497.MOV",
      geocode: "35.66\n139.73\nMinato\nTokyo\nMinato\nJP\nJapan",
      tz_offset: "+09:00",
      tags: ["night", "city"],
      colors: [[200, 30, 40]] as [number, number, number][],
      alt_text: "City lights from an observation deck.",
      weather: weatherFixture,
    },
  };

  const open = (props: Partial<React.ComponentProps<typeof LocalVideoBlockEl>> = {}) => {
    render(
      <LocalVideoBlockEl
        id="DSCF7497.MOV"
        src="/data/albums/2511japan/.resized_videos/DSCF7497.MOV@1920.mp4"
        mimeType="video/mp4"
        originalTechnicalData={{ codec: "hevc" }}
        reading={reading}
        {...props}
      />,
    );
    // jsdom does not toggle a <details> from a click on its summary.
    const details = screen.getByLabelText("Video details").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle", { bubbles: true }));
  };

  it("says when, where and with what the clip was shot", () => {
    open();

    expect(screen.getByText("Location")).toBeTruthy();
    expect(screen.getByTestId("clip-map").textContent).toBe("35.6602,139.7292");
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "TD" &&
          element.textContent?.startsWith("1 December 2025 at 20:15 (+09:00)") === true,
      ),
    ).toBeTruthy();
    expect(screen.getByText("0:07")).toBeTruthy();
    expect(screen.getByText("FUJIFILM X-T5")).toBeTruthy();
    expect(screen.getByText("23mm f/1.4")).toBeTruthy();
    expect(screen.getByText("𝑓/1.4")).toBeTruthy();
    expect(screen.getByText("4000")).toBeTruthy();
  });

  it("carries what the index says about the clip's frame", () => {
    open();

    expect(screen.getByRole("link", { name: "night" })).toBeTruthy();
    expect(
      screen.getByLabelText("Search photos with similar colour rgb(200, 30, 40)"),
    ).toBeTruthy();
    expect(screen.getByText("City lights from an observation deck.")).toBeTruthy();
    expect(screen.getByText("Weather")).toBeTruthy();
    expect(screen.getByText("Similar to ../albums/2511japan/DSCF7497.MOV")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Wander from here" })).toHaveAttribute(
      "href",
      "/explore/wander?wander=..%2Falbums%2F2511japan%2FDSCF7497.MOV",
    );
    // The encoding is still there for whoever wants it.
    expect(screen.getByText("hevc")).toBeTruthy();
  });

  // An inferred place is a guess with a reason, and the pane gives the reason.
  it("says where an inferred location came from", () => {
    open({
      reading: { ...reading, locationInferredFrom: { photo: "DSCF7490.JPG", minutesApart: -4 } },
    });

    expect(screen.getByText("From DSCF7490.JPG, 4 minutes before")).toBeTruthy();
  });

  // What happens and what is said, window by window, each linked to its moment.
  it("lays out the clip's timeline, each moment linked and speech quoted", () => {
    open({
      reading: {
        ...reading,
        timeline: [
          { start: 0, end: 15, description: "Traffic passes a lit crossing." },
          { start: 15, end: 30, description: "A bus pulls in.", speech: "Mind the gap." },
        ],
      },
    });

    const timeline = screen.getByRole("list", { name: "Timeline" });
    const moments = within(timeline).getAllByRole("link");
    expect(moments.map((link) => link.textContent)).toEqual(["0:00", "0:15"]);
    expect(moments[1]).toHaveAttribute("href", "?t=15#DSCF7497.MOV");
    expect(within(timeline).getByText("A bus pulls in.")).toBeTruthy();
    expect(within(timeline).getByText("Mind the gap.").tagName).toBe("Q");
  });

  it("seeks the clip to a moment chosen in its timeline, and keeps the moment in the URL", () => {
    open({
      reading: { ...reading, timeline: [{ start: 15, end: 30, description: "A bus pulls in." }] },
    });
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "readyState", { configurable: true, value: 1 });
    Object.defineProperty(video, "duration", { configurable: true, value: 60 });

    fireEvent.click(within(screen.getByRole("list", { name: "Timeline" })).getByRole("link"));

    expect(video.currentTime).toBe(15);
    expect(window.location.search).toBe("?t=15");
    expect(window.location.hash).toBe("#DSCF7497.MOV");
  });

  it("shows no location row for a clip that has none", () => {
    const { latDeg: _lat, lngDeg: _lng, ...unplaced } = reading;
    open({ reading: unplaced });

    expect(screen.queryByText("Location")).toBeNull();
    expect(screen.queryByTestId("clip-map")).toBeNull();
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

  // Without a poster a local clip is a black rectangle until it plays, and the
  // extracted frame is already on disk for the indexer and the search tiles.
  it("shows the extracted poster frame before the clip plays", () => {
    const { container } = render(
      <LocalVideoBlockEl
        id="video-local-1"
        src="/data/albums/foo/.resized_videos/clip.mp4@1920.mp4"
        posterSrc="/data/albums/foo/.resized_images/clip.mp4%401600.avif"
      />,
    );

    expect(container.querySelector("video")).toHaveAttribute(
      "poster",
      "/data/albums/foo/.resized_images/clip.mp4%401600.avif",
    );
  });

  it("omits the poster attribute when no frame was extracted", () => {
    const { container } = render(
      <LocalVideoBlockEl
        id="video-local-1"
        src="/data/albums/foo/.resized_videos/clip.mp4@1920.mp4"
      />,
    );

    expect(container.querySelector("video")).not.toHaveAttribute("poster");
  });

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
