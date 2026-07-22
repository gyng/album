import React from "react";
import { useWakeLock } from "../../components/useWakeLock";
import { DocumentHead } from "../../components/platform";
import { BUILD_VERSION } from "../../lib/buildVersion";
import { decideBuildUpdate } from "../../util/kioskRefresh";
import { navigateTo } from "../../util/navigate";
import {
  buildSlideshowRuntimeUrl,
  isSlideshowRuntimeMessage,
  planRuntimeReload,
  recordRuntimeReload,
  RuntimeReloadTracker,
  SLIDESHOW_EXIT_MESSAGE,
  SLIDESHOW_NAVIGATE_MESSAGE,
  SLIDESHOW_SHELL_STATE_MESSAGE,
  SLIDESHOW_WAKE_REQUEST_MESSAGE,
} from "../../util/slideshowShell";
import styles from "./SlideshowShellScreen.module.css";

const VERSION_POLL_MS = 300000;
// How long a freshly mounted runtime frame has to report it is ready before the
// shell treats it as a failed load and attempts a capped recovery reload. This
// rescues a first-ever visit whose runtime request failed transiently: the
// version poll cannot help because the advertised and running versions match.
export const RUNTIME_READY_TIMEOUT_MS = 20000;
// Give the browser's automatic (gesture-free) wake-lock acquisition a moment to
// settle before offering the full-screen tap gate, so it does not flash and
// swallow taps during the acquire window on every launch.
export const AUTO_WAKE_SETTLE_MS = 1000;

type VersionManifest = {
  buildVersion?: string;
};

type CodeStatus = "loading" | "checking" | "current" | "reloading" | "retry" | "error" | "offline";

type RuntimeFrame = { src: string; generation: number };

const shortVersion = (version: string): string => version.slice(0, 8);

const codeStatusLabel = (status: CodeStatus): string => {
  switch (status) {
    case "loading":
      return "Starting runtime";
    case "checking":
      return "Checking code";
    case "reloading":
      return "Reloading code";
    case "retry":
      return "Update retry pending";
    case "error":
      return "Code check failed";
    case "offline":
      return "Code check offline";
    default:
      return "Code current";
  }
};

/**
 * Persistent document for the installed slideshow PWA. The photo application
 * runs in a same-origin frame, so a deploy can replace that frame without
 * tearing down this document or the screen wake lock it owns.
 */
export const SlideshowShellScreen = () => {
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const latestVersionRef = React.useRef<string>(BUILD_VERSION);
  const runtimeSearchRef = React.useRef("");
  const checkInFlightRef = React.useRef(false);
  const runtimeReadyRef = React.useRef(false);
  const reloadTrackerRef = React.useRef<RuntimeReloadTracker | null>(null);
  const reloadTimerRef = React.useRef<number | null>(null);
  // The target a pending backoff timer is aiming at, so a re-plan toward the same
  // target can keep the existing timer instead of resetting it.
  const pendingReloadTargetRef = React.useRef<string | null>(null);
  const [runtimeFrame, setRuntimeFrame] = React.useState<RuntimeFrame | null>(null);
  const [runtimeVersion, setRuntimeVersion] = React.useState(BUILD_VERSION);
  const runtimeVersionRef = React.useRef(BUILD_VERSION);
  const [codeStatus, setCodeStatus] = React.useState<CodeStatus>("checking");
  const [isOnline, setIsOnline] = React.useState(true);
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
  const [wakePromptAcknowledged, setWakePromptAcknowledged] = React.useState(false);
  const [autoWakeSettled, setAutoWakeSettled] = React.useState(false);
  const [lastCheckedAt, setLastCheckedAt] = React.useState<Date | null>(null);
  const {
    isSupported: isWakeLockSupported,
    isActive: isWakeLockActive,
    acquire: acquireWakeLock,
  } = useWakeLock(false);

  React.useEffect(() => {
    runtimeSearchRef.current = window.location.search;
    setRuntimeFrame({ src: buildSlideshowRuntimeUrl(runtimeSearchRef.current), generation: 0 });
    setIsOnline(navigator.onLine);
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setAutoWakeSettled(true), AUTO_WAKE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const clearPendingReload = React.useCallback(() => {
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
    pendingReloadTargetRef.current = null;
  }, []);

  const reloadRuntime = React.useCallback((buildVersion: string) => {
    runtimeReadyRef.current = false;
    setCodeStatus("reloading");
    setRuntimeFrame((current) => ({
      src: buildSlideshowRuntimeUrl(runtimeSearchRef.current, buildVersion),
      generation: (current?.generation ?? -1) + 1,
    }));
  }, []);

  // Reboot the runtime frame toward a target build under a per-target retry cap
  // and escalating backoff, so a version the served bundle can never satisfy
  // (CDN skew, a stale cached document, or a frame that never loads) stops
  // rebooting the slideshow forever. Shared by the version poll and the
  // readiness-recovery path. The attempt budget is spent only when a reload
  // actually runs, and a re-plan toward a target that already has a pending
  // timer keeps that timer rather than resetting it — otherwise a kiosk waking
  // several times inside one backoff window would burn the whole budget without
  // a single frame ever reloading.
  const attemptRuntimeReload = React.useCallback(
    (targetVersion: string) => {
      const plan = planRuntimeReload(targetVersion, reloadTrackerRef.current);
      if (!plan.shouldReload) {
        // Budget exhausted — hold until the target version changes again.
        clearPendingReload();
        setCodeStatus("retry");
        return;
      }
      if (plan.delayMs === 0) {
        // Immediate reload: cancel any pending timer and count this execution.
        clearPendingReload();
        reloadTrackerRef.current = recordRuntimeReload(targetVersion, reloadTrackerRef.current);
        reloadRuntime(targetVersion);
        return;
      }
      // Backoff. Keep an existing timer toward the same target untouched so
      // repeated re-plans neither reset the delay nor spend the budget, but
      // still reflect the pending retry in diagnostics — checkForCodeUpdate
      // optimistically sets "checking" before this call, and without this the
      // status would read as an in-flight check that already finished.
      if (reloadTimerRef.current !== null && pendingReloadTargetRef.current === targetVersion) {
        setCodeStatus("retry");
        return;
      }
      clearPendingReload();
      setCodeStatus("retry");
      pendingReloadTargetRef.current = targetVersion;
      reloadTimerRef.current = window.setTimeout(() => {
        reloadTimerRef.current = null;
        pendingReloadTargetRef.current = null;
        // The attempt is counted here, at actual execution, not when planned.
        reloadTrackerRef.current = recordRuntimeReload(targetVersion, reloadTrackerRef.current);
        reloadRuntime(targetVersion);
      }, plan.delayMs);
    },
    [clearPendingReload, reloadRuntime],
  );

  React.useEffect(
    () => () => {
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
      }
    },
    [],
  );

  // A deliberate user gesture (the diagnostics "Reload slideshow" button) always
  // reloads, bypassing the retry budget cap — but it must still cancel a pending
  // backoff timer (otherwise that timer later fires a spurious back-to-back
  // second reload) and record the attempt, same as every other reload path.
  const reloadRuntimeManually = React.useCallback(() => {
    const targetVersion = latestVersionRef.current;
    clearPendingReload();
    reloadTrackerRef.current = recordRuntimeReload(targetVersion, reloadTrackerRef.current);
    reloadRuntime(targetVersion);
  }, [clearPendingReload, reloadRuntime]);

  // Recover a frame that never reports it is ready — e.g. a first-ever visit
  // whose runtime request failed transiently, where the version poll cannot
  // help because the advertised and running versions already match. Each new
  // generation gets one readiness deadline; missing it triggers a capped,
  // backed-off reload toward the version we intend to run.
  const generation = runtimeFrame?.generation;
  React.useEffect(() => {
    if (generation === undefined || runtimeReadyRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (runtimeReadyRef.current) {
        return;
      }
      attemptRuntimeReload(latestVersionRef.current);
    }, RUNTIME_READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [generation, attemptRuntimeReload]);

  const checkForCodeUpdate = React.useCallback(async () => {
    if (checkInFlightRef.current) {
      return;
    }
    if (!navigator.onLine) {
      setCodeStatus("offline");
      setIsOnline(false);
      return;
    }

    checkInFlightRef.current = true;
    setCodeStatus("checking");
    try {
      const response = await fetch("/version.json", { cache: "no-store" });
      if (!response.ok) {
        setCodeStatus("error");
        return;
      }

      const manifest = (await response.json()) as VersionManifest;
      const latestVersion = manifest.buildVersion?.trim();
      setIsOnline(true);
      setLastCheckedAt(new Date());
      if (!latestVersion) {
        setCodeStatus("error");
        return;
      }

      latestVersionRef.current = latestVersion;
      if (decideBuildUpdate(latestVersion, runtimeVersionRef.current)) {
        attemptRuntimeReload(latestVersion);
        return;
      }
      if (runtimeReadyRef.current) {
        // Healthy: the running build matches the latest advertised one. Clear
        // any spent retry budget so a future update starts from a full count,
        // and cancel a pending backoff reload — the frame is fine, so a stale
        // timer would otherwise fire a spurious reboot.
        reloadTrackerRef.current = null;
        clearPendingReload();
        setCodeStatus("current");
      } else {
        setCodeStatus("loading");
      }
    } catch (error) {
      console.error("Slideshow code update check failed", error);
      const online = navigator.onLine;
      setIsOnline(online);
      setCodeStatus(online ? "error" : "offline");
    } finally {
      checkInFlightRef.current = false;
    }
  }, [attemptRuntimeReload, clearPendingReload]);

  React.useEffect(() => {
    void checkForCodeUpdate();
    const interval = window.setInterval(() => {
      void checkForCodeUpdate();
    }, VERSION_POLL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForCodeUpdate();
      }
    };
    const handleOnline = () => {
      setIsOnline(true);
      void checkForCodeUpdate();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setCodeStatus("offline");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [checkForCodeUpdate]);

  React.useEffect(() => {
    const sendShellState = () => {
      frameRef.current?.contentWindow?.postMessage(
        {
          type: SLIDESHOW_SHELL_STATE_MESSAGE,
          isSupported: isWakeLockSupported,
          isActive: isWakeLockActive,
        },
        window.location.origin,
      );
    };
    const handleRuntimeMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frameRef.current?.contentWindow ||
        !isSlideshowRuntimeMessage(event.data)
      ) {
        return;
      }

      if (event.data.type === SLIDESHOW_EXIT_MESSAGE) {
        navigateTo("/");
        return;
      }
      if (event.data.type === SLIDESHOW_NAVIGATE_MESSAGE) {
        navigateTo(event.data.href);
        return;
      }
      if (event.data.type === SLIDESHOW_WAKE_REQUEST_MESSAGE) {
        void acquireWakeLock();
        return;
      }

      const nextVersion = event.data.buildVersion.trim();
      if (typeof event.data.search === "string") {
        runtimeSearchRef.current = event.data.search;
      }
      runtimeReadyRef.current = true;
      runtimeVersionRef.current = nextVersion;
      setRuntimeVersion(nextVersion);
      if (nextVersion === latestVersionRef.current) {
        // The frame loaded the intended build: cancel any pending backoff reload
        // (e.g. a slow first load that reports ready mid-backoff) so a stale
        // timer cannot reboot it, and clear any spent retry budget. A ready
        // message reporting a DIFFERENT (stale) version must NOT cancel a
        // pending backoff timer — the runtime re-posts this message on every
        // photo advance, so during version skew the frame keeps reporting its
        // old version and an unconditional cancel here would suppress every
        // retry toward the version that is still outstanding.
        clearPendingReload();
        reloadTrackerRef.current = null;
      }
      setCodeStatus(
        !navigator.onLine
          ? "offline"
          : nextVersion === latestVersionRef.current
            ? "current"
            : "retry",
      );
      sendShellState();
    };

    window.addEventListener("message", handleRuntimeMessage);
    sendShellState();
    return () => window.removeEventListener("message", handleRuntimeMessage);
  }, [
    acquireWakeLock,
    clearPendingReload,
    isWakeLockActive,
    isWakeLockSupported,
    runtimeFrame?.generation,
  ]);

  const diagnosticsSummary = [
    isWakeLockActive ? "awake" : isWakeLockSupported ? "wake lock off" : "no wake lock",
    codeStatus === "current" ? `code ${shortVersion(runtimeVersion)}` : codeStatusLabel(codeStatus),
    isOnline ? "online" : "offline",
  ].join(", ");

  return (
    <main className={styles.shell}>
      <DocumentHead>
        <title>Slideshow | Snapshots</title>
        <meta name="theme-color" content="#000000" />
      </DocumentHead>

      {runtimeFrame ? (
        <iframe
          key={runtimeFrame.generation}
          ref={frameRef}
          className={styles.runtime}
          src={runtimeFrame.src}
          title="Slideshow"
          data-runtime-generation={runtimeFrame.generation}
          allow="fullscreen"
          allowFullScreen
        />
      ) : (
        <div className={styles.bootStatus} role="status">
          Starting slideshow…
        </div>
      )}

      {autoWakeSettled && isWakeLockSupported && !isWakeLockActive && !wakePromptAcknowledged ? (
        <button
          type="button"
          className={styles.wakeGate}
          onClick={() => {
            setWakePromptAcknowledged(true);
            void acquireWakeLock();
          }}
        >
          <span className={styles.wakeGateDot} aria-hidden="true" />
          Tap once to keep this slideshow awake through code updates
        </button>
      ) : null}

      <section
        className={styles.diagnostics}
        role="group"
        aria-label="Slideshow diagnostics"
        data-open={String(diagnosticsOpen)}
        data-code-status={codeStatus}
      >
        <button
          type="button"
          className={styles.diagnosticsToggle}
          aria-expanded={diagnosticsOpen}
          aria-label="Slideshow diagnostics"
          title={diagnosticsSummary}
          onClick={() => setDiagnosticsOpen((current) => !current)}
        >
          <span
            className={[styles.statusDot, isWakeLockActive ? styles.statusGood : styles.statusWarn]
              .filter(Boolean)
              .join(" ")}
            aria-hidden="true"
          />
          <span className={styles.diagnosticsCompactLabel}>
            {codeStatus === "current" ? shortVersion(runtimeVersion) : codeStatusLabel(codeStatus)}
          </span>
        </button>

        <div className={styles.diagnosticsPanel} hidden={!diagnosticsOpen}>
          <div className={styles.diagnosticRow}>
            <span>Screen</span>
            <strong>
              {isWakeLockActive
                ? "Screen awake"
                : isWakeLockSupported
                  ? "Wake lock off"
                  : "Unavailable"}
            </strong>
          </div>
          <div className={styles.diagnosticRow}>
            <span>Code</span>
            <strong>{codeStatusLabel(codeStatus)}</strong>
          </div>
          <div className={styles.diagnosticRow}>
            <span>Network</span>
            <strong>{isOnline ? "Online" : "Offline"}</strong>
          </div>
          <div className={styles.versionRow} title={runtimeVersion}>
            runtime {shortVersion(runtimeVersion)} · shell {shortVersion(BUILD_VERSION)}
          </div>
          {lastCheckedAt ? (
            <div className={styles.versionRow}>
              checked {lastCheckedAt.toLocaleTimeString("en-GB")}
            </div>
          ) : null}
          <div className={styles.diagnosticActions}>
            {isWakeLockSupported && !isWakeLockActive ? (
              <button
                type="button"
                className={styles.wakeAction}
                onClick={() => void acquireWakeLock()}
              >
                Keep screen awake
              </button>
            ) : null}
            <button type="button" onClick={() => void checkForCodeUpdate()}>
              Check for code update
            </button>
            <button type="button" onClick={reloadRuntimeManually}>
              Reload slideshow
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default SlideshowShellScreen;
