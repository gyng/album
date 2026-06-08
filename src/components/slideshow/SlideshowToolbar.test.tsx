/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { SlideshowToolbar, SlideshowToolbarProps } from "./SlideshowToolbar";
import { EMPTY_POOL_STATS } from "../../util/slideshowQueue";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const noop = () => {};

const makeProps = (
  overrides: Partial<SlideshowToolbarProps> = {},
): SlideshowToolbarProps => ({
  onFocusCapture: noop,
  onPointerOverToolbar: noop,
  poolStats: EMPTY_POOL_STATS,
  albumName: "Album",
  photoName: "Photo",
  playbackSubtitle: "Sub",
  playbackContextLabel: "Context",
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
  onInspectImage: noop,
  onCopyLink: noop,
  copiedPhotoLink: false,
  onShare: noop,
  ...overrides,
});

describe("SlideshowToolbar", () => {
  it("renders a home link to the gallery root (the pull-up toolbar is the only way back on touch)", () => {
    render(<SlideshowToolbar {...makeProps()} />);

    const home = screen.getByRole("link", { name: /snapshots/i });
    expect(home.getAttribute("href")).toBe("/");
  });
});
