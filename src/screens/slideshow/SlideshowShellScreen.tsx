import React from "react";
import { useWakeLock } from "../../components/useWakeLock";
import { DocumentHead } from "../../components/platform";
import { BUILD_VERSION } from "../../lib/buildVersion";
import { decideBuildUpdate } from "../../util/kioskRefresh";
import { navigateTo } from "../../util/navigate";
import {
  appendShellEvent,
  describeShellEvent,
  detectHeartbeatGap,
  HEARTBEAT_INTERVAL_MS,
  readHeartbeat,
  readShellLog,
  serialiseDiagnostics,
  writeHeartbeat,
  type ShellLogEntry,
} from "../../util/shellDiagnosticsLog";
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
// How long the lock may stay inactive (while settled and visible) before the
// shell treats it as a SUSTAINED loss and re-shows the one-tap wake gate. A
// short blip while the hook re-acquires must not re-surface the affordance, so
// only a continuous loss past this window counts.
export const WAKE_LOSS_RESET_MS = 60000;

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
  // The target version we last recorded a "retry cap reached" event for, so the
  // repeating version poll logs that milestone once per stuck deploy, not per poll.
  const retryCapVersionRef = React.useRef<string | null>(null);
  const [runtimeFrame, setRuntimeFrame] = React.useState<RuntimeFrame | null>(null);
  const [runtimeVersion, setRuntimeVersion] = React.useState(BUILD_VERSION);
  const runtimeVersionRef = React.useRef(BUILD_VERSION);
  const [codeStatus, setCodeStatus] = React.useState<CodeStatus>("checking");
  const [isOnline, setIsOnline] = React.useState(true);
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
  const [wakePromptAcknowledged, setWakePromptAcknowledged] = React.useState(false);
  const [autoWakeSettled, setAutoWakeSettled] = React.useState(false);
  const [lastCheckedAt, setLastCheckedAt] = React.useState<Date | null>(null);
  const [pageVisible, setPageVisible] = React.useState(true);
  const [wakeLossCount, setWakeLossCount] = React.useState(0);
  const [lastWakeLossAt, setLastWakeLossAt] = React.useState<Date | null>(null);
  const [eventHistory, setEventHistory] = React.useState<ShellLogEntry[]>([]);
  const [copiedDiagnostics, setCopiedDiagnostics] = React.useState(false);
  const copiedTimerRef = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );
  // When this session started, for the copied report. A ref (not state) — it is
  // read only on demand and must never trigger a render.
  const sessionStartRef = React.useRef(Date.now());
  // The last runtime build we recorded as skewed, so the per-photo re-post of the
  // ready message during a stuck deploy records "version skew" once per episode
  // rather than on every advance.
  const lastSkewVersionRef = React.useRef<string | null>(null);
  const {
    isSupported: isWakeLockSupported,
    isActive: isWakeLockActive,
    acquire: acquireWakeLock,
    subscribe: subscribeWakeEvents,
  } = useWakeLock(false);
  const prevWakeActiveRef = React.useRef(isWakeLockActive);
  // Whether a loss is currently outstanding, so a later true transition is
  // logged as a genuine "re-acquired after loss" rather than the initial acquire.
  const hadWakeLossRef = React.useRef(false);

  React.useEffect(() => {
    runtimeSearchRef.current = window.location.search;
    setRuntimeFrame({ src: buildSlideshowRuntimeUrl(runtimeSearchRef.current), generation: 0 });
    setIsOnline(navigator.onLine);
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setAutoWakeSettled(true), AUTO_WAKE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Track document visibility so the sustained-loss detector does not count a
  // backgrounded page (whose lock is inactive by design) as a wake-lock loss,
  // and record each hidden/visible transition to the timeline.
  const prevVisibleRef = React.useRef(true);
  React.useEffect(() => {
    const syncVisibility = () => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (visible !== prevVisibleRef.current) {
        prevVisibleRef.current = visible;
        setEventHistory(
          appendShellEvent({ category: "visibility", type: visible ? "visible" : "hidden" }),
        );
      }
    };
    prevVisibleRef.current = document.visibilityState === "visible";
    setPageVisible(prevVisibleRef.current);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  // Heartbeat gap forensics. Every 60s overwrite ONE rolling storage key with the
  // current time — deliberately WITHOUT setState, so a days-long kiosk never
  // re-renders per beat. On mount and on every return to visibility, compare the
  // last persisted beat against now: a gap past the freeze threshold means the JS
  // loop was frozen/asleep in between (the device slept), which is distinct from
  // "running but the lock was refused" — the key forensic ambiguity a field
  // report otherwise cannot resolve. The interval and listener are both cleared
  // on unmount.
  React.useEffect(() => {
    const recordGapIfAny = () => {
      const now = Date.now();
      const gap = detectHeartbeatGap(readHeartbeat(), now);
      if (gap !== null) {
        setEventHistory(appendShellEvent({ category: "gap", type: "gap", durationMs: gap }, now));
      }
      writeHeartbeat(now);
    };
    // Mount check reads the PRE-relaunch beat before the interval overwrites it.
    recordGapIfAny();
    const beat = window.setInterval(() => writeHeartbeat(Date.now()), HEARTBEAT_INTERVAL_MS);
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        recordGapIfAny();
      }
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      window.clearInterval(beat);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, []);

  // Load the persisted event timeline once on mount so an overnight incident is
  // still readable the morning after a relaunch.
  React.useEffect(() => {
    setEventHistory(readShellLog());
  }, []);

  // Subscribe to the hook's internal outcomes (re-acquire failures, cap
  // reached/decayed) — the only wake facts the shell cannot see from isActive —
  // and append each to the persistent log.
  React.useEffect(() => {
    return subscribeWakeEvents((event) => {
      setEventHistory(appendShellEvent({ category: "wake", type: event }));
    });
  }, [subscribeWakeEvents]);

  // Record wake-lock losses for the diagnostics panel so the next field report
  // is debuggable. Count only a true→false transition while the page is
  // visible — a backgrounding turns the lock off deliberately and is not a loss.
  // The paired false→true transition (only after a real loss) records a
  // re-acquisition, so the persistent log shows the full lost/regained cycle.
  React.useEffect(() => {
    const wasActive = prevWakeActiveRef.current;
    prevWakeActiveRef.current = isWakeLockActive;
    if (wasActive === isWakeLockActive) {
      return;
    }
    if (!isWakeLockActive && document.visibilityState === "visible") {
      setWakeLossCount((count) => count + 1);
      setLastWakeLossAt(new Date());
      hadWakeLossRef.current = true;
      setEventHistory(appendShellEvent({ category: "wake", type: "lost" }));
    } else if (isWakeLockActive && hadWakeLossRef.current) {
      hadWakeLossRef.current = false;
      setEventHistory(appendShellEvent({ category: "wake", type: "acquired" }));
    }
  }, [isWakeLockActive]);

  // A lock lost long after the launch tap must bring the one-tap gate back, but
  // only on a SUSTAINED loss — a brief blip while the hook re-acquires must not
  // re-surface it. Arm a timer while the lock stays off (settled and visible);
  // it is cleared the moment the lock returns, the page hides, or we unmount.
  // Acknowledging the gate is itself a fresh user interaction, so it is a
  // dependency here: dismissing restarts the window, buying a full 60s before
  // the gate can reappear (and moving the wake-failure e2e's flake horizon from
  // settle+60s to dismissal+60s).
  React.useEffect(() => {
    if (!isWakeLockSupported || !autoWakeSettled || isWakeLockActive || !pageVisible) {
      return;
    }
    const timer = window.setTimeout(() => setWakePromptAcknowledged(false), WAKE_LOSS_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [isWakeLockSupported, autoWakeSettled, isWakeLockActive, pageVisible, wakePromptAcknowledged]);

  // A pointer gesture on the SHELL CHROME (the diagnostics control, the wake
  // gate, and any letterbox margin around the frame) while the lock is off is a
  // chance to acquire it, since Safari grants wake locks under user activation
  // where it rejects a gesture-free request. This window listener does NOT see
  // taps inside the runtime iframe — those never bubble to the parent window;
  // the runtime forwards its own gestures via SLIDESHOW_WAKE_REQUEST_MESSAGE,
  // which covers the main slideshow surface. Passive, no visual change, removed
  // once active.
  React.useEffect(() => {
    if (!isWakeLockSupported || isWakeLockActive) {
      return;
    }
    const handlePointerDown = () => {
      void acquireWakeLock();
    };
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isWakeLockSupported, isWakeLockActive, acquireWakeLock]);

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
    setEventHistory(appendShellEvent({ category: "code", type: "reload", version: buildVersion }));
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
        // Budget exhausted — hold until the target version changes again. Record
        // the cap once per target: the version poll keeps re-planning the same
        // exhausted target every few minutes, and an unguarded append would flood
        // the timeline out of every other event over a night.
        clearPendingReload();
        setCodeStatus("retry");
        if (retryCapVersionRef.current !== targetVersion) {
          retryCapVersionRef.current = targetVersion;
          setEventHistory(appendShellEvent({ category: "code", type: "retry-cap-reached" }));
        }
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

  // Serialise a full diagnostics report ON DEMAND (built only here, retained
  // nowhere) and copy it to the clipboard so a field report is one tap away. The
  // device/runtime context is read transiently; the payload is the event
  // timeline plus current status. Clipboard write falls back to the hidden
  // textarea + execCommand path used elsewhere in the slideshow for browsers
  // without the async Clipboard API.
  const copyDiagnostics = React.useCallback(async () => {
    const payload = serialiseDiagnostics({
      now: Date.now(),
      sessionStart: sessionStartRef.current,
      buildVersion: BUILD_VERSION,
      runtimeVersion: runtimeVersionRef.current,
      codeStatus,
      wake: {
        supported: isWakeLockSupported,
        active: isWakeLockActive,
        losses: wakeLossCount,
      },
      online: isOnline,
      device: {
        userAgent: navigator.userAgent,
        standalone:
          typeof window.matchMedia === "function" &&
          window.matchMedia("(display-mode: standalone)").matches,
        screen: {
          width: window.screen?.width ?? 0,
          height: window.screen?.height ?? 0,
        },
        devicePixelRatio: window.devicePixelRatio ?? 1,
      },
      log: readShellLog(),
    });
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = payload;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.inset = "0 auto auto -9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setCopiedDiagnostics(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopiedDiagnostics(false);
      }, 1800);
    } catch (error) {
      console.error("Failed to copy slideshow diagnostics", error);
    }
  }, [codeStatus, isOnline, isWakeLockActive, isWakeLockSupported, wakeLossCount]);

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
        // The stuck episode is over — allow the NEXT one toward the same
        // target to log its own retry-cap event rather than being deduped
        // against a night that ended weeks ago.
        retryCapVersionRef.current = null;
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
      setEventHistory(appendShellEvent({ category: "network", type: "online" }));
      void checkForCodeUpdate();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setCodeStatus("offline");
      setEventHistory(appendShellEvent({ category: "network", type: "offline" }));
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
        lastSkewVersionRef.current = null;
        retryCapVersionRef.current = null;
      } else if (lastSkewVersionRef.current !== nextVersion) {
        // Newly-observed skew: the running frame is behind the advertised build.
        // The runtime re-posts this on every photo advance, so record it once per
        // episode rather than on every advance.
        lastSkewVersionRef.current = nextVersion;
        setEventHistory(
          appendShellEvent({ category: "code", type: "version-skew", version: nextVersion }),
        );
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
        data-wake-settled={String(autoWakeSettled)}
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
          <div className={styles.diagnosticRow}>
            <span>Wake losses</span>
            <strong>{wakeLossCount}</strong>
          </div>
          {lastWakeLossAt ? (
            <div className={styles.versionRow}>
              last loss {lastWakeLossAt.toLocaleTimeString("en-GB")}
            </div>
          ) : null}
          <div className={styles.versionRow} title={runtimeVersion}>
            runtime {shortVersion(runtimeVersion)} · shell {shortVersion(BUILD_VERSION)}
          </div>
          {lastCheckedAt ? (
            <div className={styles.versionRow}>
              checked {lastCheckedAt.toLocaleTimeString("en-GB")}
            </div>
          ) : null}
          {eventHistory.length > 0 ? (
            <details
              className={styles.wakeHistory}
              onToggle={(event) => {
                // Refresh the rendered tail lazily, only when the disclosure is
                // opened — the timeline is never polled on a timer.
                if ((event.currentTarget as HTMLDetailsElement).open) {
                  setEventHistory(readShellLog());
                }
              }}
            >
              <summary>Event history</summary>
              <ul className={styles.wakeHistoryList}>
                {eventHistory
                  .slice(-10)
                  .reverse()
                  .map((entry, index) => (
                    <li
                      key={`${entry.at}-${index}`}
                      className={styles.wakeHistoryItem}
                      data-category={entry.category}
                    >
                      <span>{describeShellEvent(entry)}</span>
                      <time dateTime={new Date(entry.at).toISOString()}>
                        {new Date(entry.at).toLocaleString("en-GB")}
                        {entry.category !== "gap" &&
                        entry.lastAt !== undefined &&
                        entry.lastAt !== entry.at
                          ? ` – ${new Date(entry.lastAt).toLocaleTimeString("en-GB")}`
                          : null}
                      </time>
                    </li>
                  ))}
              </ul>
            </details>
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
            <button
              type="button"
              className={styles.copyAction}
              onClick={() => void copyDiagnostics()}
            >
              {copiedDiagnostics ? "Copied" : "Copy diagnostics"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default SlideshowShellScreen;
