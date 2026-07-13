import React from "react";
import Link from "next/link";
import styles from "../../pages/slideshow/slideshow.module.css";
import commonStyles from "../../styles/common.module.css";
import { SlideshowMode, DetailsAlignment } from "../../util/slideshowUrl";
import { PoolStats, formatNewestPhotoDate } from "../../util/slideshowQueue";

// The slideshow's control panel. Presentational: every value and action is
// supplied by the page, which owns the state and the imperative side effects
// (promises, refs). Lifted out of pages/slideshow/index.tsx to keep that file
// focused on orchestration.
export type SlideshowToolbarProps = {
  // Container interaction
  onFocusCapture: () => void;
  onPointerOverToolbar: (over: boolean) => void;

  // Pool / context
  poolStats: PoolStats;
  dataVersionLabel: string | null;
  dataVersionTitle: string | null;
  isCheckingDataVersion: boolean;
  onCheckDataVersion: () => void;
  filter?: string;
  albumName: string;
  photoName: string;
  playbackSubtitle: string;
  playbackContextLabel: string;

  // Playback
  slideshowMode: SlideshowMode;
  onSelectMode: (mode: SlideshowMode) => void;
  timeAware: boolean;
  onToggleTimeAware: () => void;
  remixEnabled: boolean;
  onToggleRemix: () => void;
  onRemixNow: () => void;
  isPaused: boolean;
  onTogglePaused: () => void;
  canGoPrevious: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onHide: () => void;
  controlsHideProgress: number;

  // Display
  showClock: boolean;
  onToggleClock: () => void;
  showDetails: boolean;
  onToggleDetails: () => void;
  showMap: boolean;
  onToggleMap: () => void;
  detailsAlignment: DetailsAlignment;
  onCycleAlignment: () => void;

  // View
  showCover: boolean;
  onToggleCover: () => void;
  isFullscreenActive: boolean;
  isFullscreenSupported: boolean;
  onToggleFullscreen: () => void;
  isWakeLockActive: boolean;
  isWakeLockSupported: boolean;
  onTryWakeLock: () => void;

  // Timing
  timeDelay: number;
  onSelectDelay: (delayMs: number) => void;
  showLongTimings: boolean;
  onToggleLongTimings: () => void;
  secondsLeft: number;
  alignCadence: boolean;
  onToggleAlign: () => void;

  // Context actions
  onInspectImage: () => void;
  onCopyLink: () => void;
  copiedPhotoLink: boolean;
  onShare: () => void;
};

const SHORT_TIMINGS = [10000, 30000, 60000, 900000, 3600000];
const LONG_TIMINGS = [10800000, 43200000, 86400000];

const formatCountdown = (secondsLeft: number): string => {
  if (secondsLeft >= 3600) {
    return `${Math.floor(secondsLeft / 3600)}h ${Math.floor((secondsLeft % 3600) / 60)}m`;
  }
  if (secondsLeft >= 60) {
    return `${Math.floor(secondsLeft / 60)}m ${Math.floor(secondsLeft % 60)}s`;
  }
  return `${Math.floor(secondsLeft)}s`;
};

export const SlideshowToolbar: React.FC<SlideshowToolbarProps> = (props) => {
  // Long-press the Context icon to inspect the current image — local to the
  // toolbar, so the timer/fired refs live here.
  const contextLongPressTimerRef = React.useRef<number | null>(null);
  const contextLongPressFiredRef = React.useRef(false);

  // Clear a pending long-press timer on unmount so its inspect `alert` can't
  // fire after the toolbar (or the whole slideshow) has gone.
  React.useEffect(() => {
    return () => {
      if (contextLongPressTimerRef.current !== null) {
        window.clearTimeout(contextLongPressTimerRef.current);
      }
    };
  }, []);

  const activeIsLong = LONG_TIMINGS.includes(props.timeDelay);
  const visibleTimings =
    props.showLongTimings || activeIsLong ? [...SHORT_TIMINGS, ...LONG_TIMINGS] : SHORT_TIMINGS;

  // Swipe-to-dismiss on the sticky close handle. The toolbar is taller than a
  // phone viewport, so a "swipe up anywhere to close" gesture can't coexist
  // with scrolling the panel body — the handle owns the dismiss instead (the
  // standard sheet-grabber pattern). Dragging it up drives the existing
  // retract preview (--touch-toolbar-hide-preview-progress) and commits past a
  // threshold; a plain tap still closes via onClick.
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);
  const closeDragStartYRef = React.useRef<number | null>(null);
  const suppressCloseClickRef = React.useRef(false);
  const CLOSE_DISMISS_PX = 56;
  const CLOSE_DRAG_RANGE_PX = 120;
  const CLOSE_TAP_SLOP_PX = 10;

  const setHidePreview = (progress: number) => {
    toolbarRef.current?.style.setProperty(
      "--touch-toolbar-hide-preview-progress",
      String(progress),
    );
  };
  const clearHidePreview = () => {
    toolbarRef.current?.style.removeProperty("--touch-toolbar-hide-preview-progress");
  };

  const handleCloseHandlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") return;
    closeDragStartYRef.current = event.clientY;
    // Fresh gesture: drop any stale suppression from a prior touch whose
    // synthesised click never arrived (self-correcting).
    suppressCloseClickRef.current = false;
    // setPointerCapture throws if the pointer is already gone; capture is a
    // nicety (keeps move events flowing off the element), not load-bearing.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore — the gesture still resolves on pointerup
    }
  };
  const handleCloseHandlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (closeDragStartYRef.current === null) return;
    const delta = event.clientY - closeDragStartYRef.current;
    // Only an upward drag reveals the retract; downward does nothing.
    const progress = Math.max(0, Math.min(1, -delta / CLOSE_DRAG_RANGE_PX));
    setHidePreview(progress);
  };
  const handleCloseHandlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (closeDragStartYRef.current === null) return;
    const delta = event.clientY - closeDragStartYRef.current;
    closeDragStartYRef.current = null;
    clearHidePreview();
    // Touch resolves entirely here — a synthesised click is unreliable under
    // pointer capture + touch-action: none, so we always swallow it and decide
    // ourselves. Tap or committed upward swipe closes; a downward drag doesn't.
    suppressCloseClickRef.current = true;
    if (delta <= -CLOSE_DISMISS_PX || Math.abs(delta) < CLOSE_TAP_SLOP_PX) {
      props.onHide();
    }
  };
  const handleCloseHandlePointerCancel = () => {
    closeDragStartYRef.current = null;
    clearHidePreview();
  };

  return (
    <div
      ref={toolbarRef}
      className={styles.toolbar}
      onFocusCapture={props.onFocusCapture}
      onBlur={() => props.onPointerOverToolbar(false)}
      onMouseEnter={() => props.onPointerOverToolbar(true)}
      onMouseLeave={() => props.onPointerOverToolbar(false)}
    >
      {/* The two actions used to begin an iPad viewing session stay together
          at the top of the touch sheet. The first button also remains the
          swipe-up grabber, while the second makes wake-lock status visible
          without requiring a hunt through the View section. */}
      <div className={styles.sessionDock} role="group" aria-label="Slideshow session">
        <button
          type="button"
          className={styles.toolbarCloseButton}
          style={{ touchAction: "none" }}
          onPointerDown={handleCloseHandlePointerDown}
          onPointerMove={handleCloseHandlePointerMove}
          onPointerUp={handleCloseHandlePointerUp}
          onPointerCancel={handleCloseHandlePointerCancel}
          onClick={() => {
            if (suppressCloseClickRef.current) {
              suppressCloseClickRef.current = false;
              return;
            }
            props.onHide();
          }}
          aria-label="Hide controls"
        >
          <span className={styles.toolbarCloseGrip} aria-hidden="true" />
          <span className={styles.sessionActionIcon} aria-hidden="true">
            ↓
          </span>
          <span className={styles.sessionActionCopy}>
            <strong>Hide controls</strong>
            <span>Return to photos</span>
          </span>
          <span
            className={styles.sessionProgress}
            aria-hidden="true"
            style={
              {
                "--hide-progress": String(Math.max(0, Math.min(1, props.controlsHideProgress))),
              } as React.CSSProperties
            }
          >
            <span className={styles.hideProgressRing} />
          </span>
        </button>

        <button
          type="button"
          className={[
            styles.sessionAwakeButton,
            props.isWakeLockActive ? styles.sessionAwakeButtonActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={!props.isWakeLockSupported}
          aria-disabled={!props.isWakeLockSupported}
          aria-pressed={props.isWakeLockActive}
          aria-label={props.isWakeLockActive ? "Screen stays awake" : "Keep screen awake"}
          onClick={props.onTryWakeLock}
        >
          <span className={styles.sessionAwakeIndicator} aria-hidden="true" />
          <span className={styles.sessionActionCopy}>
            <strong>
              {props.isWakeLockActive
                ? "Screen stays awake"
                : props.isWakeLockSupported
                  ? "Keep screen awake"
                  : "Awake unavailable"}
            </strong>
            <span>
              {props.isWakeLockActive
                ? "Active for this session"
                : props.isWakeLockSupported
                  ? "Recommended on iPad"
                  : "Not supported here"}
            </span>
          </span>
        </button>
      </div>

      {/* Home link / escape hatch back to the gallery. On desktop it's the
          top-left nav element; on touch it lives inside this toolbar, which
          only appears after a deliberate pull gesture — so an iPad still has a
          way home without it being a one-tap accident on a kiosk. */}
      <Link className={styles.brandLink} href="/">
        <span className={styles.brandLogo} aria-hidden="true">
          🖼️
        </span>
        <span className={styles.brandCopy}>
          <span className={styles.brandTitle}>Snapshots</span>
          <span className={styles.brandSubtitle}>Slideshow</span>
        </span>
      </Link>

      {props.poolStats.count > 0 ? (
        <button
          type="button"
          className={styles.poolStats}
          title={props.dataVersionTitle ?? "Photo pool - tap to check for the latest data"}
          onClick={props.onCheckDataVersion}
        >
          <span className={styles.poolStatsCount}>
            {props.poolStats.count.toLocaleString("en-GB")} photos
          </span>
          {props.poolStats.newestDate ? (
            <span className={styles.poolStatsNewest}>
              newest {formatNewestPhotoDate(props.poolStats.newestDate)}
            </span>
          ) : null}
          <span className={styles.poolStatsNewest}>
            {props.isCheckingDataVersion
              ? "checking data"
              : (props.dataVersionLabel ?? "data unknown")}
          </span>
        </button>
      ) : null}

      <div className={styles.playbackGroup} role="group" aria-label="Playback mode">
        <div className={styles.playbackHeader}>
          <span className={styles.playbackLogo} aria-hidden="true">
            ⟲
          </span>
          <span className={styles.playbackCopy}>
            <span className={styles.playbackTitle}>Playback</span>
            <span className={styles.playbackSubtitle}>{props.playbackSubtitle}</span>
          </span>
        </div>

        <div className={styles.playbackButtons}>
          <button
            className={[
              props.slideshowMode === "random" ? commonStyles.active : "",
              commonStyles.button,
            ].join(" ")}
            aria-pressed={props.slideshowMode === "random"}
            onClick={() => props.onSelectMode("random")}
          >
            🔀 Shuffle
          </button>

          <button
            className={[
              props.slideshowMode === "weighted" ? commonStyles.active : "",
              commonStyles.button,
            ].join(" ")}
            aria-pressed={props.slideshowMode === "weighted"}
            onClick={() => props.onSelectMode("weighted")}
          >
            🕒 Recent
          </button>

          <button
            className={[
              props.slideshowMode === "similar" ? commonStyles.active : "",
              commonStyles.button,
            ].join(" ")}
            aria-pressed={props.slideshowMode === "similar"}
            onClick={() => props.onSelectMode("similar")}
          >
            🧭 Similar
          </button>

          <span className={styles.playbackDivider} aria-hidden="true" />

          <button
            className={[
              props.timeAware ? commonStyles.active : "",
              styles.playbackModifier,
              commonStyles.button,
            ].join(" ")}
            aria-pressed={props.timeAware}
            title="Bias the shuffle toward photos taken near the current hour and month"
            onClick={props.onToggleTimeAware}
          >
            🌅 Time-of-day
          </button>

          <button
            className={[
              props.remixEnabled ? commonStyles.active : "",
              styles.playbackModifier,
              commonStyles.button,
            ].join(" ")}
            aria-pressed={props.remixEnabled}
            title="Occasionally show two or three photos side by side at random"
            onClick={props.onToggleRemix}
          >
            ◫ Remix
          </button>

          <span className={styles.playbackDivider} aria-hidden="true" />

          <button
            className={commonStyles.button}
            title="Force the next advance to be a remix slide (ignores the 3% dice)"
            onClick={props.onRemixNow}
          >
            ◫ Remix now
          </button>

          <button
            className={[props.isPaused ? commonStyles.active : "", commonStyles.button].join(" ")}
            aria-pressed={props.isPaused}
            onClick={props.onTogglePaused}
          >
            {props.isPaused ? "▶ Resume" : "⏸ Pause"}
          </button>

          <button
            className={commonStyles.button}
            disabled={!props.canGoPrevious}
            aria-disabled={!props.canGoPrevious}
            onClick={props.onPrevious}
          >
            Previous
          </button>

          <button className={commonStyles.button} onClick={props.onNext}>
            Next
          </button>

          <span className={[styles.playbackHideGroup, styles.secondarySessionControl].join(" ")}>
            <button className={commonStyles.button} onClick={props.onHide}>
              Hide
            </button>

            <div
              className={styles.hideProgress}
              aria-hidden="true"
              style={
                {
                  "--hide-progress": String(Math.max(0, Math.min(1, props.controlsHideProgress))),
                } as React.CSSProperties
              }
            >
              <div className={styles.hideProgressRing} />
            </div>
          </span>
        </div>
      </div>

      <div className={styles.controlGroup} role="group" aria-label="Display controls">
        <div className={styles.controlHeader}>
          <span className={styles.controlLogo} aria-hidden="true">
            ✦
          </span>
          <span className={styles.controlCopy}>
            <span className={styles.controlTitle}>Display</span>
          </span>
        </div>

        <div className={styles.controlButtons}>
          <button
            className={[props.showClock ? commonStyles.active : "", commonStyles.button].join(" ")}
            aria-pressed={props.showClock}
            onClick={props.onToggleClock}
          >
            🕰️
          </button>

          <button
            className={[props.showDetails ? commonStyles.active : "", commonStyles.button].join(
              " ",
            )}
            aria-pressed={props.showDetails}
            onClick={props.onToggleDetails}
          >
            Details
          </button>

          <button
            className={[props.showMap ? commonStyles.active : "", commonStyles.button].join(" ")}
            aria-pressed={props.showMap}
            onClick={props.onToggleMap}
          >
            Map
          </button>

          <button
            className={[
              props.detailsAlignment !== "center" ? commonStyles.active : "",
              commonStyles.button,
            ].join(" ")}
            onClick={props.onCycleAlignment}
          >
            📍 {props.detailsAlignment.charAt(0).toUpperCase() + props.detailsAlignment.slice(1)}
          </button>
        </div>
      </div>

      <div className={styles.controlGroup} role="group" aria-label="View controls">
        <div className={styles.controlHeader}>
          <span className={styles.controlLogo} aria-hidden="true">
            ⛶
          </span>
          <span className={styles.controlCopy}>
            <span className={styles.controlTitle}>View</span>
          </span>
        </div>

        <div className={styles.controlButtons}>
          <button
            className={[props.showCover ? commonStyles.active : "", commonStyles.button].join(" ")}
            aria-pressed={props.showCover}
            title={
              props.showCover
                ? "Photos fill the screen (cropping). Tap to switch to fit."
                : "Photos fit the screen (letterboxed). Tap to switch to fill."
            }
            onClick={props.onToggleCover}
          >
            ⛶ Fill screen
          </button>

          {!props.isFullscreenActive ? (
            <button
              className={commonStyles.button}
              disabled={!props.isFullscreenSupported}
              aria-disabled={!props.isFullscreenSupported}
              onClick={props.onToggleFullscreen}
            >
              ⇱ Fullscreen
            </button>
          ) : null}

          <button
            className={[
              props.isWakeLockActive ? commonStyles.active : "",
              styles.secondarySessionControl,
              commonStyles.button,
            ].join(" ")}
            disabled={!props.isWakeLockSupported}
            aria-disabled={!props.isWakeLockSupported}
            aria-pressed={props.isWakeLockActive}
            title={
              props.isWakeLockSupported
                ? "Try to acquire a wake lock for this slideshow session"
                : "Screen wake lock is not available in this browser"
            }
            onClick={props.onTryWakeLock}
          >
            {props.isWakeLockActive ? "Screen stays awake" : "Keep screen awake"}
          </button>
        </div>
      </div>

      <div className={styles.controlGroup} role="group" aria-label="Timing controls">
        <div className={styles.controlHeader}>
          <span className={styles.controlLogo} aria-hidden="true">
            ⏱
          </span>
          <span className={styles.controlCopy}>
            <span className={styles.controlTitle}>Timing</span>
          </span>
        </div>

        <div className={styles.controlButtons}>
          {visibleTimings.map((delay) => {
            const delayMin = delay / 1000 / 60;
            const delaySec = delay / 1000;
            return (
              <button
                key={delay}
                className={[
                  commonStyles.button,
                  delay === props.timeDelay ? commonStyles.active : "",
                ].join(" ")}
                aria-pressed={delay === props.timeDelay}
                onClick={() => props.onSelectDelay(delay)}
              >
                {delayMin >= 60
                  ? `${delayMin / 60}h`
                  : delayMin < 1
                    ? `${delaySec}s`
                    : `${delayMin}m`}
              </button>
            );
          })}
          {!activeIsLong ? (
            <button
              className={[
                commonStyles.button,
                props.showLongTimings ? commonStyles.active : "",
              ].join(" ")}
              aria-pressed={props.showLongTimings}
              aria-label={
                props.showLongTimings
                  ? "Hide longer cadences"
                  : "Show longer cadences (3h, 12h, 24h)"
              }
              title={
                props.showLongTimings
                  ? "Hide longer cadences"
                  : "Show longer cadences (3h, 12h, 24h)"
              }
              onClick={props.onToggleLongTimings}
            >
              {props.showLongTimings ? "Less" : "More…"}
            </button>
          ) : null}
        </div>

        <div className={styles.controlMeta}>
          <div className={commonStyles.toast}>🔁 {formatCountdown(props.secondsLeft)}</div>
          <button
            className={[props.alignCadence ? commonStyles.active : "", commonStyles.button].join(
              " ",
            )}
            type="button"
            aria-pressed={props.alignCadence}
            title="When on, advances snap to wall-clock boundaries (e.g. :00 / :15 / :30 / :45 for a 15-minute cadence) instead of drifting from the moment you opened the app"
            onClick={props.onToggleAlign}
          >
            {props.alignCadence ? "Aligned" : "Align"}
          </button>
        </div>
      </div>

      <div className={styles.controlGroup} role="group" aria-label="Current photo context">
        <div className={styles.controlHeader}>
          <span
            className={styles.controlLogo}
            role="button"
            aria-label="Long-press to inspect the current image"
            title="Long-press to inspect the current image"
            style={{ cursor: "pointer", pointerEvents: "auto" }}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              contextLongPressFiredRef.current = false;
              if (contextLongPressTimerRef.current !== null) {
                window.clearTimeout(contextLongPressTimerRef.current);
              }
              contextLongPressTimerRef.current = window.setTimeout(() => {
                contextLongPressFiredRef.current = true;
                contextLongPressTimerRef.current = null;
                props.onInspectImage();
              }, 500);
            }}
            onPointerUp={() => {
              if (contextLongPressTimerRef.current !== null) {
                window.clearTimeout(contextLongPressTimerRef.current);
                contextLongPressTimerRef.current = null;
              }
            }}
            onPointerCancel={() => {
              if (contextLongPressTimerRef.current !== null) {
                window.clearTimeout(contextLongPressTimerRef.current);
                contextLongPressTimerRef.current = null;
              }
            }}
          >
            📎
          </span>
          <span className={styles.controlCopy}>
            <span className={styles.controlTitle}>Context</span>
          </span>
        </div>

        <div className={styles.controlMeta}>
          {props.filter ? (
            <div className={commonStyles.toast}>
              Showing only photos from{" "}
              <Link href={`/album/${props.filter}`}>
                <i>{props.filter}</i>
              </Link>
            </div>
          ) : null}

          <Link
            href={`/album/${props.albumName}#${props.photoName}`}
            className={commonStyles.toast}
          >
            {props.playbackContextLabel} in <i>{props.albumName}</i>
          </Link>

          <button className={commonStyles.button} type="button" onClick={props.onCopyLink}>
            {props.copiedPhotoLink ? "copied photo link" : "copy photo link"}
          </button>

          <button
            className={commonStyles.button}
            type="button"
            title="Send the current photo to a system app via the share sheet"
            onClick={props.onShare}
          >
            ⤴ Share
          </button>
        </div>
      </div>
    </div>
  );
};
