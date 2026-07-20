import React from "react";
import { useWakeLock } from "../../components/useWakeLock";
import { DocumentHead } from "../../components/platform";
import { BUILD_VERSION } from "../../lib/buildVersion";
import { decideBuildUpdate } from "../../util/kioskRefresh";
import { navigateTo } from "../../util/navigate";
import {
  buildSlideshowRuntimeUrl,
  isSlideshowRuntimeMessage,
  SLIDESHOW_EXIT_MESSAGE,
  SLIDESHOW_NAVIGATE_MESSAGE,
  SLIDESHOW_SHELL_STATE_MESSAGE,
  SLIDESHOW_WAKE_REQUEST_MESSAGE,
} from "../../util/slideshowShell";
import styles from "./SlideshowShellScreen.module.css";

const VERSION_POLL_MS = 300000;

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
  const [runtimeFrame, setRuntimeFrame] = React.useState<RuntimeFrame | null>(null);
  const [runtimeVersion, setRuntimeVersion] = React.useState(BUILD_VERSION);
  const runtimeVersionRef = React.useRef(BUILD_VERSION);
  const [codeStatus, setCodeStatus] = React.useState<CodeStatus>("checking");
  const [isOnline, setIsOnline] = React.useState(true);
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
  const [wakePromptAcknowledged, setWakePromptAcknowledged] = React.useState(false);
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

  const reloadRuntime = React.useCallback((buildVersion: string) => {
    runtimeReadyRef.current = false;
    setCodeStatus("reloading");
    setRuntimeFrame((current) => ({
      src: buildSlideshowRuntimeUrl(runtimeSearchRef.current, buildVersion),
      generation: (current?.generation ?? -1) + 1,
    }));
  }, []);

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
        reloadRuntime(latestVersion);
        return;
      }
      setCodeStatus(runtimeReadyRef.current ? "current" : "loading");
    } catch (error) {
      console.error("Slideshow code update check failed", error);
      const online = navigator.onLine;
      setIsOnline(online);
      setCodeStatus(online ? "error" : "offline");
    } finally {
      checkInFlightRef.current = false;
    }
  }, [reloadRuntime]);

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
  }, [acquireWakeLock, isWakeLockActive, isWakeLockSupported, runtimeFrame?.generation]);

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

      {isWakeLockSupported && !isWakeLockActive && !wakePromptAcknowledged ? (
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
            <button
              type="button"
              onClick={() => {
                reloadRuntime(latestVersionRef.current);
              }}
            >
              Reload slideshow
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default SlideshowShellScreen;
