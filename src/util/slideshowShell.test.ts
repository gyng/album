import {
  buildSlideshowRuntimeUrl,
  isSlideshowRuntimeMessage,
  isSlideshowShellStateMessage,
  SLIDESHOW_EXIT_MESSAGE,
  SLIDESHOW_NAVIGATE_MESSAGE,
  SLIDESHOW_RUNTIME_STATE_MESSAGE,
  SLIDESHOW_SHELL_STATE_MESSAGE,
} from "./slideshowShell";

describe("slideshow shell protocol", () => {
  it("builds an explicitly managed runtime URL and replaces stale shell versions", () => {
    expect(buildSlideshowRuntimeUrl("?filter=favourites&shellVersion=old", "new build")).toBe(
      "/slideshow?filter=favourites&shell=1&shellVersion=new+build",
    );
  });

  it("accepts only complete runtime messages", () => {
    expect(
      isSlideshowRuntimeMessage({
        type: SLIDESHOW_RUNTIME_STATE_MESSAGE,
        buildVersion: "build-2",
      }),
    ).toBe(true);
    expect(isSlideshowRuntimeMessage({ type: SLIDESHOW_EXIT_MESSAGE })).toBe(true);
    expect(
      isSlideshowRuntimeMessage({ type: SLIDESHOW_NAVIGATE_MESSAGE, href: "/album/japan" }),
    ).toBe(true);
    expect(
      isSlideshowRuntimeMessage({ type: SLIDESHOW_NAVIGATE_MESSAGE, href: "//example.com" }),
    ).toBe(false);
    expect(
      isSlideshowRuntimeMessage({ type: SLIDESHOW_RUNTIME_STATE_MESSAGE, buildVersion: " " }),
    ).toBe(false);
    expect(isSlideshowRuntimeMessage({ type: "unrelated" })).toBe(false);
  });

  it("requires both wake-lock capability fields from shell state", () => {
    expect(
      isSlideshowShellStateMessage({
        type: SLIDESHOW_SHELL_STATE_MESSAGE,
        isSupported: true,
        isActive: false,
      }),
    ).toBe(true);
    expect(
      isSlideshowShellStateMessage({
        type: SLIDESHOW_SHELL_STATE_MESSAGE,
        isSupported: true,
      }),
    ).toBe(false);
  });
});
