import React from "react";
import { AppLink, DocumentHead } from "../../components/platform";
import { Button, Caption, Card, Heading } from "../../components/ui";
import { BUILD_VERSION } from "../../lib/buildVersion";
import {
  describeShellEvent,
  formatGapDuration,
  HEARTBEAT_GAP_THRESHOLD_MS,
  readHeartbeat,
  readShellLog,
  readShellStatus,
  readStatusPillVisible,
  serialiseDiagnostics,
  writeStatusPillVisible,
  type ShellLogEntry,
  type ShellStatusSnapshot,
} from "../../util/shellDiagnosticsLog";
import styles from "./SlideshowDiagnosticsScreen.module.css";

type Reading = {
  now: number;
  status: ShellStatusSnapshot | null;
  heartbeat: number | null;
  log: ShellLogEntry[];
};

const emptyReading: Reading = { now: 0, status: null, heartbeat: null, log: [] };

const takeReading = (): Reading => ({
  now: Date.now(),
  status: readShellStatus(),
  heartbeat: readHeartbeat(),
  log: readShellLog(),
});

const ago = (at: number, now: number): string => `${formatGapDuration(Math.max(0, now - at))} ago`;

const timeOf = (at: number): string => new Date(at).toLocaleString("en-GB");

const NOT_REPORTED = "Not reported yet";

/**
 * Full-page, readable form of the slideshow shell's diagnostics. The shell's own
 * corner panel is a glance-sized overlay that is easy to miss and hard to read on
 * a wall-mounted iPad; this is the same evidence at document size, reachable as a
 * plain URL and shareable in one tap.
 *
 * It owns no wake lock and holds no live state: everything comes from the
 * best-effort localStorage record the shell keeps (event log, heartbeat, and a
 * status snapshot), so it reads correctly in a second window beside a running
 * slideshow, or on a device whose shell was relaunched hours after the incident.
 */
export const SlideshowDiagnosticsScreen = () => {
  // Read after mount, never during render: storage is unavailable when this page
  // is prerendered, and reading it inline would hydrate into a mismatch.
  const [reading, setReading] = React.useState<Reading>(emptyReading);
  const [copied, setCopied] = React.useState(false);
  // Read after mount for the same reason as the reading above: this page is
  // prerendered, and storage does not exist then.
  const [statusPillVisible, setStatusPillVisible] = React.useState(false);
  const [canShare, setCanShare] = React.useState(false);
  const copiedTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setReading(takeReading());
    setStatusPillVisible(readStatusPillVisible());
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
    // Returning to this page (from the slideshow, or from a backgrounded tab)
    // should show what happened while it was away.
    const refresh = () => {
      if (document.visibilityState === "visible") {
        setReading(takeReading());
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  React.useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  const { now, status, heartbeat, log } = reading;
  const shellAlive = heartbeat !== null && now - heartbeat <= HEARTBEAT_GAP_THRESHOLD_MS;

  const buildReport = React.useCallback((): string => {
    const current = takeReading();
    return serialiseDiagnostics({
      now: current.now,
      sessionStart: current.status?.sessionStart ?? current.now,
      buildVersion: current.status?.shellVersion ?? BUILD_VERSION,
      runtimeVersion: current.status?.runtimeVersion ?? BUILD_VERSION,
      codeStatus: current.status?.codeStatus ?? "unknown",
      wake: current.status?.wake ?? { supported: false, active: false, losses: 0 },
      online: current.status?.online ?? navigator.onLine,
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
      log: current.log,
    });
  }, []);

  const flagCopied = React.useCallback(() => {
    setCopied(true);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2500);
  }, []);

  // The iPad path: hand the whole report to the system share sheet so it can go
  // straight to Messages, Mail, Notes, or AirDrop without an app switch.
  const shareReport = React.useCallback(async () => {
    try {
      await navigator.share({ title: "Slideshow diagnostics", text: buildReport() });
    } catch {
      // A dismissed share sheet is not an error worth surfacing.
    }
  }, [buildReport]);

  const copyReport = React.useCallback(async () => {
    const payload = buildReport();
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
      flagCopied();
    } catch {
      // Best-effort: the report stays readable on screen either way.
    }
  }, [buildReport, flagCopied]);

  return (
    <main className={styles.page}>
      <DocumentHead>
        <title>Slideshow diagnostics | Snapshots</title>
        <meta name="robots" content="noindex" />
      </DocumentHead>

      <header className={styles.header}>
        <Heading level={1} as="h1">
          Slideshow diagnostics
        </Heading>
        <Caption>
          {status
            ? `Reported by the slideshow ${ago(status.at, now)} · ${timeOf(status.at)}`
            : "The slideshow shell has not recorded anything on this device yet."}
        </Caption>
        <div className={styles.actions}>
          <AppLink className={styles.backLink} href="/slideshow/shell">
            Back to the slideshow
          </AppLink>
          {canShare ? (
            <Button variant="primary" onClick={() => void shareReport()}>
              Share report
            </Button>
          ) : null}
          <Button onClick={() => void copyReport()}>{copied ? "Copied" : "Copy report"}</Button>
        </div>
      </header>

      <Card as="section" className={styles.section} role="group" aria-label="Slideshow overlay">
        <Heading level={2}>Overlay</Heading>
        <div className={[styles.row, styles.setting].filter(Boolean).join(" ")}>
          <div className={styles.settingText}>
            <strong>Status pill</strong>
            <span className={styles.hint}>
              The build and wake-lock pill in the slideshow&rsquo;s top corner. Off by default, so
              the photos are all there is to look at; turn it on while watching a kiosk.
            </span>
          </div>
          {/* The label stays put and `aria-pressed` carries the state, so the
              control does not rename itself under the reader who just used it;
              `active` gives the same state to the eye. */}
          <Button
            active={statusPillVisible}
            aria-pressed={statusPillVisible}
            onClick={() => {
              const next = !statusPillVisible;
              setStatusPillVisible(next);
              writeStatusPillVisible(next);
            }}
          >
            Show status pill
          </Button>
        </div>
      </Card>

      <Card as="section" className={styles.section} role="group" aria-label="Screen wake lock">
        <Heading level={2}>Screen</Heading>
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>State</dt>
            <dd>
              <strong>
                {status
                  ? status.wake.supported
                    ? status.wake.active
                      ? "Screen awake"
                      : "Wake lock off"
                    : "Wake lock unavailable"
                  : NOT_REPORTED}
              </strong>
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Losses this session</dt>
            <dd>
              <strong>{status ? status.wake.losses : "—"}</strong>
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Slideshow running</dt>
            <dd>
              <strong>{shellAlive ? "Yes" : "Not right now"}</strong>
              {heartbeat !== null ? (
                <span className={styles.hint}>last beat {ago(heartbeat, now)}</span>
              ) : null}
            </dd>
          </div>
        </dl>
      </Card>

      <Card as="section" className={styles.section} role="group" aria-label="Code and network">
        <Heading level={2}>Code and network</Heading>
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>Code</dt>
            <dd>
              <strong>{status ? status.codeStatus : NOT_REPORTED}</strong>
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Network</dt>
            <dd>
              <strong>{status ? (status.online ? "Online" : "Offline") : NOT_REPORTED}</strong>
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Builds</dt>
            <dd>
              <strong>runtime {status?.runtimeVersion ?? BUILD_VERSION}</strong>
              <span className={styles.hint}>shell {status?.shellVersion ?? BUILD_VERSION}</span>
            </dd>
          </div>
          {status ? (
            <div className={styles.row}>
              <dt>Session started</dt>
              <dd>
                <strong>{timeOf(status.sessionStart)}</strong>
                <span className={styles.hint}>{ago(status.sessionStart, now)}</span>
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <Card as="section" className={styles.section} role="group" aria-label="Event history">
        <Heading level={2}>Event history</Heading>
        {log.length > 0 ? (
          <ol className={styles.events}>
            {[...log].reverse().map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className={styles.event}
                data-category={entry.category}
              >
                <span className={styles.eventLabel}>{describeShellEvent(entry)}</span>
                <time className={styles.eventTime} dateTime={new Date(entry.at).toISOString()}>
                  {timeOf(entry.at)}
                  {entry.category !== "gap" &&
                  entry.lastAt !== undefined &&
                  entry.lastAt !== entry.at
                    ? ` – ${new Date(entry.lastAt).toLocaleTimeString("en-GB")}`
                    : null}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <Caption>No events recorded on this device.</Caption>
        )}
      </Card>
    </main>
  );
};

export default SlideshowDiagnosticsScreen;
