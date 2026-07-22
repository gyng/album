/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { SlideshowToolbar, SlideshowToolbarProps } from "./SlideshowToolbar";
import { EMPTY_POOL_STATS } from "../../util/slideshowQueue";

const noop = () => {};

const makeProps = (overrides: Partial<SlideshowToolbarProps> = {}): SlideshowToolbarProps => ({
  onFocusCapture: noop,
  onPointerOverToolbar: noop,
  poolStats: EMPTY_POOL_STATS,
  dataVersionLabel: null,
  dataVersionTitle: null,
  isCheckingDataVersion: false,
  onCheckDataVersion: noop,
  albumName: "Album",
  photoName: "Photo",
  playbackSubtitle: "Sub",
  playbackContextLabel: "Context",
  onExit: noop,
  onNavigate: noop,
  slideshowMode: "random",
  onSelectMode: noop,
  timeAware: false,
  onToggleTimeAware: noop,
  remixEnabled: false,
  onToggleRemix: noop,
  onRemixNow: noop,
  isPaused: false,
  onTogglePaused: noop,
  canGoPrevious: false,
  onPrevious: noop,
  onNext: noop,
  onHide: noop,
  controlsHideProgress: 0,
  showClock: false,
  onToggleClock: noop,
  showDetails: false,
  onToggleDetails: noop,
  showMap: false,
  onToggleMap: noop,
  detailsAlignment: "left",
  onCycleAlignment: noop,
  showCover: false,
  onToggleCover: noop,
  isFullscreenActive: false,
  isFullscreenSupported: true,
  onToggleFullscreen: noop,
  isWakeLockActive: false,
  isWakeLockSupported: true,
  onTryWakeLock: noop,
  timeDelay: 10000,
  onSelectDelay: noop,
  showLongTimings: false,
  onToggleLongTimings: noop,
  secondsLeft: 10,
  alignCadence: false,
  onToggleAlign: noop,
  topic: null,
  topicBusy: false,
  topicError: null,
  onSubmitTopic: noop,
  onClearTopic: noop,
  onInspectImage: noop,
  onCopyLink: noop,
  copiedPhotoLink: false,
  onShare: noop,
  ...overrides,
});

describe("SlideshowToolbar", () => {
  const firePointer = (
    node: Element,
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    values: Record<string, string | number>,
  ) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.entries(values).forEach(([key, value]) => {
      Object.defineProperty(event, key, { configurable: true, value });
    });
    fireEvent(node, event);
  };

  it("keeps the primary iPad session actions together and easy to identify", () => {
    const onHide = jest.fn();
    const onTryWakeLock = jest.fn();

    render(<SlideshowToolbar {...makeProps({ onHide, onTryWakeLock })} />);

    const session = screen.getByRole("group", { name: "Slideshow session" });
    const hide = within(session).getByRole("button", { name: "Hide controls" });
    const awake = within(session).getByRole("button", { name: "Keep screen awake" });

    expect(session.contains(hide)).toBe(true);
    expect(session.contains(awake)).toBe(true);
    expect(awake.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(hide);
    fireEvent.click(awake);

    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onTryWakeLock).toHaveBeenCalledTimes(1);
  });

  it("delegates gallery exit so an embedded slideshow can leave its outer shell", () => {
    const onExit = jest.fn();
    render(<SlideshowToolbar {...makeProps({ onExit })} />);

    fireEvent.click(screen.getByRole("link", { name: /Snapshots Slideshow/ }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("delegates album navigation so an embedded slideshow does not navigate inside its frame", () => {
    const onNavigate = jest.fn();
    render(<SlideshowToolbar {...makeProps({ onNavigate })} />);

    fireEvent.click(screen.getByRole("link", { name: /Context in Album/ }));

    expect(onNavigate).toHaveBeenCalledWith("/album/Album#Photo");
  });

  it("lets the browser open links in a new tab on modifier and middle-clicks", () => {
    const onExit = jest.fn();
    const onNavigate = jest.fn();
    render(<SlideshowToolbar {...makeProps({ onExit, onNavigate })} />);

    const home = screen.getByRole("link", { name: /Snapshots Slideshow/ });
    const context = screen.getByRole("link", { name: /Context in Album/ });

    // A meta/ctrl/shift-click, or a middle-click, must fall through to the
    // native navigation instead of being hijacked into a same-tab handler.
    const metaClick = fireEvent.click(home, { metaKey: true });
    const middleClick = fireEvent.click(context, { button: 1 });

    expect(onExit).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    // Not prevented: fireEvent returns false only when preventDefault was called.
    expect(metaClick).toBe(true);
    expect(middleClick).toBe(true);

    // A plain primary click is still handled in-shell.
    fireEvent.click(home);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("shows an unambiguous active screen-awake status", () => {
    render(<SlideshowToolbar {...makeProps({ isWakeLockActive: true })} />);

    const session = screen.getByRole("group", { name: "Slideshow session" });
    const awake = within(session).getByRole("button", { name: "Screen stays awake" });
    expect(awake.getAttribute("aria-pressed")).toBe("true");
    expect(awake.textContent).toContain("Active for this session");
  });

  it("renders a home link to the gallery root (the pull-up toolbar is the only way back on touch)", () => {
    render(<SlideshowToolbar {...makeProps()} />);

    const home = screen.getByRole("link", { name: /snapshots/i });
    expect(home.getAttribute("href")).toBe("/");
  });

  it("shows the data version badge and checks for updates on click", () => {
    const onCheckDataVersion = jest.fn();

    render(
      <SlideshowToolbar
        {...makeProps({
          poolStats: {
            count: 1234,
            newestDate: new Date("2026-06-29T12:00:00Z"),
          },
          dataVersionLabel: "data 29 Jun 20:00",
          dataVersionTitle: "Photo database last modified 29/06/2026, 20:00:00.",
          onCheckDataVersion,
        })}
      />,
    );

    const badge = screen.getByRole("button", { name: /1,234 photos/i });
    expect(badge.textContent).toContain("data 29 Jun 20:00");

    fireEvent.click(badge);

    expect(onCheckDataVersion).toHaveBeenCalledTimes(1);
  });

  it("shows fallback and checking states for a pool without a newest date", () => {
    const { rerender } = render(
      <SlideshowToolbar
        {...makeProps({
          poolStats: { count: 2, newestDate: null },
          isCheckingDataVersion: true,
        })}
      />,
    );
    const checking = screen.getByRole("button", { name: /2 photos/i });
    expect(checking.textContent).toContain("checking data");
    expect(checking.getAttribute("title")).toContain("Photo pool");

    rerender(<SlideshowToolbar {...makeProps({ poolStats: { count: 2, newestDate: null } })} />);
    expect(screen.getByRole("button", { name: /2 photos/i }).textContent).toContain("data unknown");
  });

  it("supports close-handle taps, swipes, cancellation, and click suppression", () => {
    const onHide = jest.fn();
    const onFocusCapture = jest.fn();
    const onPointerOverToolbar = jest.fn();
    const { container } = render(
      <SlideshowToolbar {...makeProps({ onHide, onFocusCapture, onPointerOverToolbar })} />,
    );
    const hide = screen.getByRole("button", { name: "Hide controls" });
    const root = container.firstElementChild as HTMLElement;
    const capture = jest.fn();
    Object.defineProperty(hide, "setPointerCapture", { configurable: true, value: capture });

    firePointer(hide, "pointermove", { pointerType: "touch", clientY: 50, pointerId: 1 });
    firePointer(hide, "pointerup", { pointerType: "touch", clientY: 50, pointerId: 1 });
    firePointer(hide, "pointerdown", { pointerType: "mouse", clientY: 100, pointerId: 1 });
    expect(capture).not.toHaveBeenCalled();

    firePointer(hide, "pointerdown", { pointerType: "touch", clientY: 100, pointerId: 2 });
    firePointer(hide, "pointermove", { pointerType: "touch", clientY: -40, pointerId: 2 });
    expect(root.style.getPropertyValue("--touch-toolbar-hide-preview-progress")).toBe("1");
    firePointer(hide, "pointerup", { pointerType: "touch", clientY: 40, pointerId: 2 });
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(root.style.getPropertyValue("--touch-toolbar-hide-preview-progress")).toBe("");
    fireEvent.click(hide);
    expect(onHide).toHaveBeenCalledTimes(1);
    fireEvent.click(hide);
    expect(onHide).toHaveBeenCalledTimes(2);

    firePointer(hide, "pointerdown", { pointerType: "touch", clientY: 100, pointerId: 3 });
    firePointer(hide, "pointermove", { pointerType: "touch", clientY: 140, pointerId: 3 });
    expect(root.style.getPropertyValue("--touch-toolbar-hide-preview-progress")).toBe("0");
    firePointer(hide, "pointerup", { pointerType: "touch", clientY: 140, pointerId: 3 });
    expect(onHide).toHaveBeenCalledTimes(2);

    firePointer(hide, "pointerdown", { pointerType: "touch", clientY: 100, pointerId: 4 });
    firePointer(hide, "pointerup", { pointerType: "touch", clientY: 105, pointerId: 4 });
    expect(onHide).toHaveBeenCalledTimes(3);

    firePointer(hide, "pointerdown", { pointerType: "touch", clientY: 100, pointerId: 5 });
    firePointer(hide, "pointercancel", { pointerType: "touch", clientY: 100, pointerId: 5 });
    firePointer(hide, "pointerup", { pointerType: "touch", clientY: 0, pointerId: 5 });

    fireEvent.focus(root);
    fireEvent.mouseEnter(root);
    fireEvent.mouseLeave(root);
    fireEvent.blur(root);
    expect(onFocusCapture).toHaveBeenCalled();
    expect(onPointerOverToolbar.mock.calls).toEqual(expect.arrayContaining([[true], [false]]));
  });

  it("continues the close gesture when pointer capture is unavailable", () => {
    const onHide = jest.fn();
    render(<SlideshowToolbar {...makeProps({ onHide })} />);
    const hide = screen.getByRole("button", { name: "Hide controls" });
    Object.defineProperty(hide, "setPointerCapture", {
      configurable: true,
      value: () => {
        throw new Error("capture lost");
      },
    });

    firePointer(hide, "pointerdown", { pointerType: "touch", clientY: 100, pointerId: 6 });
    firePointer(hide, "pointerup", { pointerType: "touch", clientY: 20, pointerId: 6 });
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("wires every playback, display, view, timing, and context action", () => {
    const callbacks = {
      onSelectMode: jest.fn(),
      onToggleTimeAware: jest.fn(),
      onToggleRemix: jest.fn(),
      onRemixNow: jest.fn(),
      onTogglePaused: jest.fn(),
      onPrevious: jest.fn(),
      onNext: jest.fn(),
      onToggleClock: jest.fn(),
      onToggleDetails: jest.fn(),
      onToggleMap: jest.fn(),
      onCycleAlignment: jest.fn(),
      onToggleCover: jest.fn(),
      onToggleFullscreen: jest.fn(),
      onSelectDelay: jest.fn(),
      onToggleLongTimings: jest.fn(),
      onToggleAlign: jest.fn(),
      onCopyLink: jest.fn(),
      onShare: jest.fn(),
    };
    render(
      <SlideshowToolbar
        {...makeProps({
          ...callbacks,
          slideshowMode: "similar",
          timeAware: true,
          remixEnabled: true,
          isPaused: true,
          canGoPrevious: true,
          showClock: true,
          showDetails: true,
          showMap: true,
          detailsAlignment: "center",
          showCover: true,
          alignCadence: true,
          filter: "japan",
          copiedPhotoLink: true,
          secondsLeft: 3661,
        })}
      />,
    );

    const playback = screen.getByRole("group", { name: "Playback mode" });
    for (const name of [
      /Shuffle/,
      /Recent/,
      /Similar/,
      /Time-of-day/,
      /^◫ Remix$/,
      /Remix now/,
      /Resume/,
      /Previous/,
      /Next/,
    ]) {
      fireEvent.click(within(playback).getByRole("button", { name }));
    }
    expect(callbacks.onSelectMode.mock.calls).toEqual([["random"], ["weighted"], ["similar"]]);
    expect(callbacks.onToggleTimeAware).toHaveBeenCalled();
    expect(callbacks.onToggleRemix).toHaveBeenCalled();
    expect(callbacks.onRemixNow).toHaveBeenCalled();
    expect(callbacks.onTogglePaused).toHaveBeenCalled();
    expect(callbacks.onPrevious).toHaveBeenCalled();
    expect(callbacks.onNext).toHaveBeenCalled();

    const display = screen.getByRole("group", { name: "Display controls" });
    within(display)
      .getAllByRole("button")
      .forEach((button) => fireEvent.click(button));
    expect(callbacks.onToggleClock).toHaveBeenCalled();
    expect(callbacks.onToggleDetails).toHaveBeenCalled();
    expect(callbacks.onToggleMap).toHaveBeenCalled();
    expect(callbacks.onCycleAlignment).toHaveBeenCalled();

    const view = screen.getByRole("group", { name: "View controls" });
    fireEvent.click(within(view).getByRole("button", { name: /Fill screen/ }));
    fireEvent.click(within(view).getByRole("button", { name: /Fullscreen/ }));
    expect(callbacks.onToggleCover).toHaveBeenCalled();
    expect(callbacks.onToggleFullscreen).toHaveBeenCalled();

    const timing = screen.getByRole("group", { name: "Timing controls" });
    fireEvent.click(within(timing).getByRole("button", { name: "10s" }));
    fireEvent.click(within(timing).getByRole("button", { name: /Show longer cadences/ }));
    fireEvent.click(within(timing).getByRole("button", { name: "Aligned" }));
    expect(callbacks.onSelectDelay).toHaveBeenCalledWith(10000);
    expect(callbacks.onToggleLongTimings).toHaveBeenCalled();
    expect(callbacks.onToggleAlign).toHaveBeenCalled();
    expect(screen.getByText("🔁 1h 1m")).toBeTruthy();

    const context = screen.getByRole("group", { name: "Current photo context" });
    expect(within(context).getByRole("link", { name: "japan" }).getAttribute("href")).toBe(
      "/album/japan",
    );
    fireEvent.click(within(context).getByRole("button", { name: "copied photo link" }));
    fireEvent.click(within(context).getByRole("button", { name: /Share/ }));
    expect(callbacks.onCopyLink).toHaveBeenCalled();
    expect(callbacks.onShare).toHaveBeenCalled();
  });

  it("renders unsupported and active view states plus all cadence labels", () => {
    const { rerender } = render(
      <SlideshowToolbar
        {...makeProps({
          isWakeLockSupported: false,
          isFullscreenSupported: false,
          showLongTimings: true,
          secondsLeft: 61,
        })}
      />,
    );
    expect(screen.getByText("Awake unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Fullscreen/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hide longer cadences" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "3h" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "15m" })).toBeTruthy();
    expect(screen.getByText("🔁 1m 1s")).toBeTruthy();

    rerender(
      <SlideshowToolbar
        {...makeProps({
          isFullscreenActive: true,
          isWakeLockActive: true,
          timeDelay: 10800000,
          detailsAlignment: "right",
          slideshowMode: "weighted",
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /Fullscreen/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /longer cadences/i })).toBeNull();
    expect(screen.getByRole("button", { name: "3h" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Right/ })).toBeTruthy();
  });

  it("submits a trimmed topic and shows a busy state while it encodes", () => {
    const onSubmitTopic = jest.fn();
    const { rerender } = render(<SlideshowToolbar {...makeProps({ onSubmitTopic })} />);

    const topicGroup = screen.getByRole("group", { name: "Topic" });
    const input = within(topicGroup).getByRole("textbox", { name: "Slideshow topic" });
    const seed = within(topicGroup).getByRole("button", { name: "Seed" });

    // Empty submit does nothing; the button is disabled with no draft.
    expect(seed).toBeDisabled();

    fireEvent.change(input, { target: { value: "  cat " } });
    fireEvent.click(within(topicGroup).getByRole("button", { name: "Seed" }));
    expect(onSubmitTopic).toHaveBeenCalledWith("cat");

    // While busy the field is disabled and the button reflects progress.
    rerender(<SlideshowToolbar {...makeProps({ onSubmitTopic, topicBusy: true })} />);
    expect(within(topicGroup).getByRole("textbox", { name: "Slideshow topic" })).toBeDisabled();
    expect(within(topicGroup).getByRole("button", { name: "Seeding…" })).toBeDisabled();
  });

  it("shows an active topic as a dismissible chip that restores the previous mode", () => {
    const onClearTopic = jest.fn();
    render(<SlideshowToolbar {...makeProps({ topic: "cat", onClearTopic })} />);

    const topicGroup = screen.getByRole("group", { name: "Topic" });
    expect(within(topicGroup).getByText(/Topic:/)).toHaveTextContent("Topic: cat");
    // The input is replaced by the chip while a topic is active.
    expect(within(topicGroup).queryByRole("textbox", { name: "Slideshow topic" })).toBeNull();

    fireEvent.click(within(topicGroup).getByRole("button", { name: "Clear topic" }));
    expect(onClearTopic).toHaveBeenCalledTimes(1);
  });

  it("surfaces a topic error and keeps the input available for a retry", () => {
    render(
      <SlideshowToolbar
        {...makeProps({ topicError: "Topic search is unavailable right now." })}
      />,
    );

    const topicGroup = screen.getByRole("group", { name: "Topic" });
    expect(within(topicGroup).getByRole("status")).toHaveTextContent(
      "Topic search is unavailable right now.",
    );
    expect(within(topicGroup).getByRole("textbox", { name: "Slideshow topic" })).not.toBeDisabled();
  });

  it("handles cancelled, repeated, completed, and unmounted image long-presses", () => {
    jest.useFakeTimers();
    const onInspectImage = jest.fn();
    const { unmount } = render(<SlideshowToolbar {...makeProps({ onInspectImage })} />);
    const inspect = screen.getByRole("button", {
      name: "Long-press to inspect the current image",
    });

    firePointer(inspect, "pointerdown", { pointerType: "mouse", button: 2 });
    jest.advanceTimersByTime(500);
    expect(onInspectImage).not.toHaveBeenCalled();

    firePointer(inspect, "pointerdown", { pointerType: "mouse", button: 0 });
    firePointer(inspect, "pointerup", { pointerType: "mouse", button: 0 });
    jest.advanceTimersByTime(500);
    expect(onInspectImage).not.toHaveBeenCalled();

    firePointer(inspect, "pointerdown", { pointerType: "touch", button: 0 });
    firePointer(inspect, "pointerdown", { pointerType: "touch", button: 0 });
    firePointer(inspect, "pointercancel", { pointerType: "touch", button: 0 });
    jest.advanceTimersByTime(500);
    expect(onInspectImage).not.toHaveBeenCalled();

    firePointer(inspect, "pointerdown", { pointerType: "touch", button: 0 });
    jest.advanceTimersByTime(500);
    expect(onInspectImage).toHaveBeenCalledTimes(1);
    firePointer(inspect, "pointerup", { pointerType: "touch", button: 0 });
    firePointer(inspect, "pointercancel", { pointerType: "touch", button: 0 });

    firePointer(inspect, "pointerdown", { pointerType: "touch", button: 0 });
    unmount();
    jest.runOnlyPendingTimers();
    expect(onInspectImage).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
