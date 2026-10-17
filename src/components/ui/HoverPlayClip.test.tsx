/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { HoverPlayClip } from "./HoverPlayClip";

const CLIP_PATH = "../albums/trip/clip.mp4";
/** Where `getResizedAlbumVideoSrc` points a clip: the 1920px transcode beside it. */
const CLIP_SRC = "/data/albums/trip/.resized_videos/clip.mp4%401920.mp4";
const POSTER_SRC = "/data/albums/trip/.resized_images/clip.mp4%40400.avif";
const YOUTUBE_PATH = "../albums/trip/dQw4w9WgXcQ.youtube";

const originalMatchMedia = window.matchMedia;

/**
 * `jest.setup.js` reports no preference at all. A test that wants a touch
 * device, or a reader who asked for less motion, asks for it here. The value is
 * a media query list, which jsdom does not implement, so the two queries this
 * hook reads each answer on their own.
 */
const stubMediaPreferences = ({ coarsePointer = false, reducedMotion = false } = {}) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("coarse")
        ? coarsePointer
        : query.includes("prefers-reduced-motion")
          ? reducedMotion
          : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

let playSpy: jest.SpyInstance;
let pauseSpy: jest.SpyInstance;
let loadSpy: jest.SpyInstance;

beforeEach(() => {
  // jsdom throws "Not implemented" from play and pause, so what these tests
  // assert is the calls the hook makes, never real playback.
  playSpy = jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  pauseSpy = jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  // An element that is reused does not load again; one that is re-mounted may.
  loadSpy = jest.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  stubMediaPreferences();
});

afterEach(() => {
  jest.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
});

const renderTile = (clipPath: string | null = CLIP_PATH) =>
  render(
    <HoverPlayClip clipPath={clipPath} className="tile">
      <img
        data-testid="poster"
        src={POSTER_SRC}
        srcSet={`${POSTER_SRC} 400w`}
        style={{ aspectRatio: "16 / 9" }}
        alt="A clip"
      />
    </HoverPlayClip>,
  );

/** The wrapper the consumer's class is spread onto, which the poster sits in. */
const wrapper = (): HTMLElement => {
  const poster = screen.getByTestId("poster");
  const parent = poster.parentElement;
  if (parent === null) throw new Error("the poster lost its wrapper");
  return parent;
};

const previewOf = (container: HTMLElement): HTMLVideoElement => {
  const video = container.querySelector("video");
  if (video === null) throw new Error("no preview was rendered");
  return video;
};

describe("HoverPlayClip", () => {
  it("holds no media element, and asks for nothing, until a pointer arrives", () => {
    const { container } = renderTile();

    expect(container.querySelector("video")).toBeNull();
    // The wrapper carries its own class (the containing block for the preview)
    // beside the consumer's, which is what sets the display.
    expect(wrapper().tagName).toBe("SPAN");
    expect(wrapper()).toHaveClass("wrapper");
    expect(wrapper()).toHaveClass("tile");
    expect(playSpy).not.toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("holds no media element across a page of tiles", () => {
    // `preload="none"` on an element that does not exist yet: a 300-tile page
    // fetches and decodes nothing at all until one of them is hovered.
    render(
      <div>
        {Array.from({ length: 300 }, (_, index) => (
          <HoverPlayClip key={index} clipPath={CLIP_PATH} className="tile">
            <img src={POSTER_SRC} alt="" />
          </HoverPlayClip>
        ))}
      </div>,
    );

    expect(document.querySelectorAll("video")).toHaveLength(0);
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("keeps the poster exactly the element it was, and slots the preview over it", () => {
    render(
      <HoverPlayClip clipPath={CLIP_PATH} className="tile">
        <picture data-testid="picture">
          <img
            data-testid="poster"
            src={POSTER_SRC}
            srcSet={`${POSTER_SRC} 400w`}
            style={{ aspectRatio: "16 / 9" }}
            alt="A clip"
          />
        </picture>
      </HoverPlayClip>,
    );

    const picture = screen.getByTestId("picture");
    const poster = screen.getByTestId("poster");
    const tile = picture.parentElement;
    if (tile === null) throw new Error("the picture lost its wrapper");

    expect(tile.tagName).toBe("SPAN");
    expect(tile).toHaveClass("tile");

    fireEvent.pointerOver(tile);

    // Same element, same attributes, same inline style: the preview is added
    // beside the poster, never instead of it.
    expect(screen.getByTestId("poster")).toBe(poster);
    expect(poster).toHaveAttribute("src", POSTER_SRC);
    expect(poster).toHaveAttribute("srcset", `${POSTER_SRC} 400w`);
    expect(poster).toHaveAttribute("alt", "A clip");
    expect(poster.style.aspectRatio).toBe("16 / 9");
    expect(tile.querySelectorAll("video")).toHaveLength(1);
  });

  it("plays one muted inline preview on a qualifying hover", () => {
    const { container } = renderTile();

    fireEvent.pointerOver(wrapper());

    expect(container.querySelectorAll("video")).toHaveLength(1);
    const video = previewOf(container);
    // The overlay's own class carries its geometry and `pointer-events: none`.
    expect(video).toHaveClass("preview");
    expect(video).toHaveAttribute("src", CLIP_SRC);
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("loop");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("disablepictureinpicture");
    expect(video).toHaveAttribute("aria-hidden", "true");
    expect(video).toHaveAttribute("tabindex", "-1");
    // React sets `muted` as a property rather than as an attribute.
    expect(video.muted).toBe(true);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it("plays the clip a scene row was extracted from, not a file of its own", () => {
    const { container } = renderTile(`${CLIP_PATH}@t120`);

    fireEvent.pointerOver(wrapper());

    expect(previewOf(container)).toHaveAttribute("src", CLIP_SRC);
  });

  it("pauses on leave and plays again on re-entry without a second element", () => {
    const { container } = renderTile();
    const tile = wrapper();

    fireEvent.pointerOver(tile);
    const video = previewOf(container);
    expect(playSpy).toHaveBeenCalledTimes(1);

    fireEvent.pointerOut(tile);
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    fireEvent.pointerOver(tile);
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(previewOf(container)).toBe(video);
    expect(previewOf(container)).toHaveAttribute("src", CLIP_SRC);
    expect(playSpy).toHaveBeenCalledTimes(2);
    // Reusing the element is what makes the second hover instant: a re-mount
    // would be a second request for the same file.
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("pauses when the gesture is cancelled", () => {
    const { container } = renderTile();

    fireEvent.pointerOver(wrapper());
    expect(playSpy).toHaveBeenCalledTimes(1);

    fireEvent.pointerCancel(wrapper());

    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("video")).toHaveLength(1);
  });

  it("pauses on blur and never plays for focus alone", () => {
    const { container } = renderTile();
    const tile = wrapper();

    // React 19 hangs onFocus and onBlur off focusin and focusout, not off
    // focus and blur, so these are the two events a keyboard reader produces.
    fireEvent.focusIn(tile);
    expect(container.querySelector("video")).toBeNull();
    expect(playSpy).not.toHaveBeenCalled();

    fireEvent.pointerOver(tile);
    fireEvent.focusOut(tile);

    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("pauses while the tab is hidden and resumes only for a pointer still inside", () => {
    const { container } = renderTile();
    const hiddenSpy = jest.spyOn(document, "hidden", "get").mockReturnValue(false);

    fireEvent.pointerOver(wrapper());
    expect(playSpy).toHaveBeenCalledTimes(1);

    hiddenSpy.mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledTimes(1);

    hiddenSpy.mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));
    expect(playSpy).toHaveBeenCalledTimes(2);

    // The pointer left while the tab was away, so coming back leaves it paused.
    fireEvent.pointerOut(wrapper());
    hiddenSpy.mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    hiddenSpy.mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));

    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll("video")).toHaveLength(1);
  });

  it("never arms on a coarse pointer", () => {
    stubMediaPreferences({ coarsePointer: true });
    const { container } = renderTile();

    fireEvent.pointerOver(wrapper());

    expect(container.querySelector("video")).toBeNull();
    expect(playSpy).not.toHaveBeenCalled();
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it("never arms under reduced motion", () => {
    stubMediaPreferences({ reducedMotion: true });
    const { container } = renderTile();

    fireEvent.pointerOver(wrapper());

    expect(container.querySelector("video")).toBeNull();
    expect(playSpy).not.toHaveBeenCalled();
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it("never arms for a YouTube external, which has no playable file", () => {
    const { container } = renderTile(YOUTUBE_PATH);

    fireEvent.pointerOver(wrapper());

    expect(container.querySelector("video")).toBeNull();
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("never arms without a clip path", () => {
    const { container } = renderTile(null);

    fireEvent.pointerOver(wrapper());

    expect(container.querySelector("video")).toBeNull();
    expect(playSpy).not.toHaveBeenCalled();
  });
});
