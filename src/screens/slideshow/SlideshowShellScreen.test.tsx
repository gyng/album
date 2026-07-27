/**
 * @jest-environment jsdom
 */

import { Profiler } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AUTO_WAKE_SETTLE_MS,
  RUNTIME_READY_TIMEOUT_MS,
  WAKE_LOSS_RESET_MS,
  SlideshowShellScreen,
} from "./SlideshowShellScreen";
import { RUNTIME_RELOAD_BASE_DELAY_MS } from "../../util/slideshowShell";
import { useWakeLock, type WakeLockEvent } from "../../components/useWakeLock";
import { navigateTo } from "../../util/navigate";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STORAGE_KEY,
  readShellLog,
  readShellStatus,
  SHELL_LOG_STORAGE_KEY,
  STATUS_PILL_STORAGE_KEY,
  writeStatusPillVisible,
} from "../../util/shellDiagnosticsLog";

const acquireWakeLock = jest.fn().mockResolvedValue(undefined);
const releaseWakeLock = jest.fn().mockResolvedValue(undefined);
// Captures the shell's wake-event listener so tests can push internal outcomes
// (re-acquire failures, cap reached/decayed) the real hook would emit.
let wakeEventListener: ((event: WakeLockEvent) => void) | null = null;
const subscribeWakeEvents = jest.fn((listener: (event: WakeLockEvent) => void) => {
  wakeEventListener = listener;
  return () => {
    wakeEventListener = null;
  };
});
let mockWakeLockSupported = true;
let mockWakeLockActive = true;

jest.mock("../../lib/buildVersion", () => ({ BUILD_VERSION: "build-current" }));
jest.mock("../../util/navigate", () => ({ navigateTo: jest.fn() }));
jest.mock("../../components/useWakeLock", () => ({
  useWakeLock: jest.fn(),
}));

const mockNavigateTo = jest.mocked(navigateTo);
const mockUseWakeLock = jest.mocked(useWakeLock);

const versionResponse = (buildVersion: string) =>
  Promise.resolve({
    ok: true,
    json: async () => ({ buildVersion }),
  } as Response);

const pendingVersionResponse = () => new Promise<Response>(() => {});

describe("slideshow code shell", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    wakeEventListener = null;
    mockWakeLockSupported = true;
    // Default the lock to ACTIVE. This keeps two effects dormant for the whole
    // suite: the sustained-loss reset timer and the pointerdown re-acquire
    // listener both early-return while the lock is active, so most tests never
    // render the full-screen wake gate. Any future fake-timer test that flips
    // this to false and advances >= WAKE_LOSS_RESET_MS will re-render the
    // full-screen gate over the diagnostics UI — query around it accordingly.
    mockWakeLockActive = true;
    mockUseWakeLock.mockImplementation(() => ({
      // A bare EventTarget stands in for the WakeLockSentinel the ref carries.
      ref: { current: new EventTarget() as unknown as WakeLockSentinel },
      isSupported: mockWakeLockSupported,
      isActive: mockWakeLockActive,
      acquire: acquireWakeLock,
      release: releaseWakeLock,
      subscribe: subscribeWakeEvents,
    }));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    // The corner status pill is opt-in — the slideshow shows photos, not
    // instrumentation. Most cases here are about what the panel reports, so
    // they turn it on; the default-off behaviour has its own case below.
    writeStatusPillVisible(true);
    window.history.replaceState({}, "", "/slideshow/shell?filter=test-simple&delay=60");
  });

  it("keeps the document canvas black only while the slideshow shell is mounted", () => {
    global.fetch = jest.fn(pendingVersionResponse);

    expect(document.documentElement).not.toHaveAttribute("data-slideshow-shell");

    const { unmount } = render(<SlideshowShellScreen />);

    expect(document.documentElement).toHaveAttribute("data-slideshow-shell");

    unmount();

    expect(document.documentElement).not.toHaveAttribute("data-slideshow-shell");
  });

  it("keeps the status pill off the slideshow until diagnostics asks for it", async () => {
    // Nothing about the pill is load-bearing for the slideshow itself, and a
    // version string with a wake-lock dot floating over the photos is
    // instrumentation. The diagnostics *group* stays in the tree either way:
    // `data-wake-settled` is how tests and the report page learn that the
    // automatic wake attempt has finished.
    writeStatusPillVisible(false);
    global.fetch = jest.fn(() => versionResponse("build-current"));

    render(<SlideshowShellScreen />);
    expect(screen.getByRole("group", { name: "Slideshow diagnostics" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Slideshow diagnostics" })).not.toBeInTheDocument();

    // Turned on from the other document, which can only reach this one through
    // storage — so the running shell has to notice without being reloaded.
    act(() => {
      writeStatusPillVisible(true);
      fireEvent(
        window,
        new StorageEvent("storage", { key: STATUS_PILL_STORAGE_KEY, newValue: "on" }),
      );
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Slideshow diagnostics" })).toBeInTheDocument(),
    );
  });

  it("reloads only the slideshow frame when a new build appears", async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => versionResponse("build-current"))
      .mockImplementationOnce(() => versionResponse("build-next"));
    global.fetch = fetchMock;

    render(<SlideshowShellScreen />);

    const frame = screen.getByTitle("Slideshow");
    expect(frame).toHaveAttribute("src", "/slideshow?filter=test-simple&delay=60&shell=1");

    fireEvent(
      window,
      new MessageEvent("message", {
        data: { type: "snapshots:slideshow-ready", buildVersion: "build-current" },
        origin: window.location.origin,
        source: (frame as HTMLIFrameElement).contentWindow,
      }),
    );

    await waitFor(() => expect(screen.getByText("Code current")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Slideshow diagnostics" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for code update" }));

    await waitFor(() =>
      expect(screen.getByTitle("Slideshow")).toHaveAttribute(
        "src",
        "/slideshow?filter=test-simple&delay=60&shell=1&shellVersion=build-next",
      ),
    );
    expect(screen.getAllByText("Reloading code")).not.toHaveLength(0);
    expect(
      readShellLog(window.localStorage).find(
        (entry) => entry.category === "code" && entry.type === "reload",
      ),
    ).toMatchObject({ version: "build-next", reason: "build-update" });
    expect(releaseWakeLock).not.toHaveBeenCalled();
  });

  it("attributes a build reload to an activating service worker when it triggered the check", async () => {
    const serviceWorker = new EventTarget();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => versionResponse("build-current"))
      .mockImplementationOnce(() => versionResponse("build-next"));
    global.fetch = fetchMock;

    try {
      render(<SlideshowShellScreen />);
      await waitFor(() => expect(screen.getByText(/checked /)).toBeInTheDocument());

      act(() => {
        serviceWorker.dispatchEvent(new Event("controllerchange"));
      });

      await waitFor(() =>
        expect(screen.getByTitle("Slideshow")).toHaveAttribute(
          "src",
          "/slideshow?filter=test-simple&delay=60&shell=1&shellVersion=build-next",
        ),
      );
      expect(
        readShellLog(window.localStorage).find(
          (entry) => entry.category === "code" && entry.type === "reload",
        ),
      ).toMatchObject({ version: "build-next", reason: "service-worker-update" });
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });

  it("stops rebooting the frame once a stuck build exhausts its retry budget", async () => {
    // A frame that never reports it is ready drives the readiness-recovery path
    // to its cap. version.json keeps advertising the shell's own build so the
    // update path stays idle and only the recovery cap governs the reboots.
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;
      render(<SlideshowShellScreen />);

      // Advance well past every readiness deadline and escalating backoff.
      for (let step = 0; step < 12; step++) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          jest.advanceTimersByTime(RUNTIME_READY_TIMEOUT_MS + RUNTIME_RELOAD_BASE_DELAY_MS * 4);
          await Promise.resolve();
          await Promise.resolve();
        });
      }

      const settled = screen.getByTitle("Slideshow").getAttribute("data-runtime-generation");
      // Exactly the capped number of reboots (generations 1..3 past the initial 0).
      expect(settled).toBe("3");

      // Further time must not reboot again until the target version changes.
      await act(async () => {
        jest.advanceTimersByTime(RUNTIME_READY_TIMEOUT_MS * 20);
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("3");
    } finally {
      jest.useRealTimers();
    }
  });

  it("cancels a pending backoff reload once the frame finally reports it is ready", async () => {
    // A slow first load can miss one readiness deadline (scheduling a backoff
    // reload) and then report ready during the backoff window. The pending timer
    // must be cancelled, otherwise it fires a guaranteed spurious reboot.
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;
      render(<SlideshowShellScreen />);

      // Miss the first readiness deadline → immediate recovery reload → gen 1.
      await act(async () => {
        jest.advanceTimersByTime(RUNTIME_READY_TIMEOUT_MS + 1);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("1");

      // Miss gen 1's readiness deadline → a backoff reload is scheduled, but no
      // reboot happens yet (the frame stays on generation 1).
      await act(async () => {
        jest.advanceTimersByTime(RUNTIME_READY_TIMEOUT_MS + 1);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("1");

      // The frame reports ready during the backoff window.
      const frame = screen.getByTitle("Slideshow");
      await act(async () => {
        fireEvent(
          window,
          new MessageEvent("message", {
            data: { type: "snapshots:slideshow-ready", buildVersion: "build-current" },
            origin: window.location.origin,
            source: (frame as HTMLIFrameElement).contentWindow,
          }),
        );
        await Promise.resolve();
      });

      // Advancing past the backoff delay must not reboot the now-healthy frame.
      await act(async () => {
        jest.advanceTimersByTime(RUNTIME_RELOAD_BASE_DELAY_MS * 4);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("1");
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps a pending backoff reload alive when the frame reports a stale version", async () => {
    // Version skew: reload #1 lands, but the frame comes back ready on the OLD
    // build (it keeps re-posting its ready state on every photo advance). That
    // stale-version ready message must NOT cancel a backoff timer aimed at the
    // still-outstanding target version, otherwise retries 2-3 never run and the
    // kiosk is stuck on the old build forever.
    jest.useFakeTimers();
    try {
      const fetchMock = jest
        .fn()
        .mockImplementationOnce(() => versionResponse("build-current"))
        .mockImplementationOnce(() => versionResponse("build-next"));
      global.fetch = fetchMock;

      render(<SlideshowShellScreen />);

      // Initial check: no update yet.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // A new build appears: immediate reload (attempt 1) to generation 1.
      fireEvent.click(screen.getByRole("button", { name: "Slideshow diagnostics" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Check for code update" }));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("1");

      // Generation 1 never reports ready in time: schedules a backed-off retry
      // (attempt 2) toward "build-next", but does not reboot yet.
      await act(async () => {
        jest.advanceTimersByTime(RUNTIME_READY_TIMEOUT_MS + 1);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("1");

      // The stuck frame is still alive and posting its OLD build version (e.g. it
      // is still advancing photos on the old bundle) while the backoff toward
      // "build-next" is pending.
      const frame = screen.getByTitle("Slideshow");
      await act(async () => {
        fireEvent(
          window,
          new MessageEvent("message", {
            data: { type: "snapshots:slideshow-ready", buildVersion: "build-current" },
            origin: window.location.origin,
            source: (frame as HTMLIFrameElement).contentWindow,
          }),
        );
        await Promise.resolve();
      });

      // The pending backoff timer must survive and still fire the retry.
      await act(async () => {
        jest.advanceTimersByTime(RUNTIME_RELOAD_BASE_DELAY_MS * 4);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("2");
    } finally {
      jest.useRealTimers();
    }
  });

  it("resets a stuck 'checking' status back to retry when a pending backoff timer is kept", async () => {
    // checkForCodeUpdate optimistically sets "checking" before attemptRuntimeReload
    // runs. When that call hits the keep-existing-timer early return (a re-plan
    // toward the same still-pending target), the status must be restored to
    // "retry" rather than left showing a check that already finished.
    jest.useFakeTimers();
    try {
      const fetchMock = jest
        .fn()
        .mockImplementationOnce(() => versionResponse("build-current"))
        .mockImplementationOnce(() => versionResponse("build-next"))
        .mockImplementationOnce(() => versionResponse("build-next"));
      global.fetch = fetchMock;

      render(<SlideshowShellScreen />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      fireEvent.click(screen.getByRole("button", { name: "Slideshow diagnostics" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Check for code update" }));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("1");

      // Miss generation 1's readiness deadline: schedules the backed-off retry.
      await act(async () => {
        jest.advanceTimersByTime(RUNTIME_READY_TIMEOUT_MS + 1);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getAllByText("Update retry pending")).not.toHaveLength(0);

      // A re-plan toward the same pending target (another manual check) must not
      // leave the status stuck on "checking".
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Check for code update" }));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getAllByText("Update retry pending")).not.toHaveLength(0);
      expect(screen.queryByText("Checking code")).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("routes the manual reload button through the same reload discipline", async () => {
    // The manual "Reload slideshow" diagnostics button is a deliberate user
    // gesture that may bypass the retry budget, but it must still cancel a
    // pending backoff timer (otherwise the timer fires afterwards for a
    // spurious back-to-back double reload) and record the attempt.
    jest.useFakeTimers();
    try {
      const fetchMock = jest
        .fn()
        .mockImplementationOnce(() => versionResponse("build-current"))
        .mockImplementationOnce(() => versionResponse("build-next"));
      global.fetch = fetchMock;

      render(<SlideshowShellScreen />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      fireEvent.click(screen.getByRole("button", { name: "Slideshow diagnostics" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Check for code update" }));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("1");

      // Miss generation 1's readiness deadline: schedules a backed-off retry.
      await act(async () => {
        jest.advanceTimersByTime(RUNTIME_READY_TIMEOUT_MS + 1);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("1");

      // Manual reload fires immediately, cancelling the pending timer.
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Reload slideshow" }));
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("2");
      expect(
        readShellLog(window.localStorage)
          .filter((entry) => entry.category === "code" && entry.type === "reload")
          .at(-1),
      ).toMatchObject({ reason: "manual" });

      // The now-cancelled backoff timer must not fire a second, back-to-back
      // reload once its original delay elapses. Advance past that delay but
      // stay under the new generation's own readiness deadline, so only the
      // (would-be) stale timer is under test here.
      await act(async () => {
        jest.advanceTimersByTime(RUNTIME_RELOAD_BASE_DELAY_MS + 1000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("2");
    } finally {
      jest.useRealTimers();
    }
  });

  it("recovers a frame that never reports it is ready even when versions match", async () => {
    // First-ever visit whose runtime request fails transiently: the advertised
    // and running versions are equal, so the version poll cannot help — only the
    // readiness deadline can force a reload.
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;
      render(<SlideshowShellScreen />);
      const initial = screen.getByTitle("Slideshow").getAttribute("data-runtime-generation");
      expect(initial).toBe("0");

      await act(async () => {
        jest.advanceTimersByTime(RUNTIME_READY_TIMEOUT_MS + 1);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTitle("Slideshow").getAttribute("data-runtime-generation")).toBe("1");
      expect(
        readShellLog(window.localStorage).find(
          (entry) => entry.category === "code" && entry.type === "reload",
        ),
      ).toMatchObject({ reason: "runtime-timeout" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("mirrors its live state into storage so the full report page can read it", async () => {
    // The full-page report replaces this document rather than running beside it,
    // so it can only see what the shell has persisted.
    mockWakeLockActive = false;
    global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

    render(<SlideshowShellScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      const status = readShellStatus();
      expect(status?.wake).toEqual({ supported: true, active: false, losses: 0 });
      expect(status?.shellVersion).toBe("build-current");
    });
  });

  it("links from the diagnostics panel to the full report page", () => {
    global.fetch = jest.fn(pendingVersionResponse);

    render(<SlideshowShellScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Slideshow diagnostics" }));

    expect(screen.getByRole("link", { name: /full report/i })).toHaveAttribute(
      "href",
      "/slideshow/diagnostics",
    );
  });

  it("withholds the one-tap wake prompt until the auto-acquire window settles", async () => {
    jest.useFakeTimers();
    try {
      mockWakeLockActive = false;
      global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

      render(<SlideshowShellScreen />);

      const promptName = "Tap once to keep this slideshow awake through code updates";
      // Chrome may acquire without a gesture; the gate must not flash meanwhile.
      expect(screen.queryByRole("button", { name: promptName })).not.toBeInTheDocument();
      // The e2e specs key off this attribute to know when the gate decision is
      // final — it must read false until the settle window elapses.
      const diagnostics = screen.getByRole("group", { name: "Slideshow diagnostics" });
      expect(diagnostics).toHaveAttribute("data-wake-settled", "false");

      await act(async () => {
        jest.advanceTimersByTime(AUTO_WAKE_SETTLE_MS);
        await Promise.resolve();
      });

      expect(diagnostics).toHaveAttribute("data-wake-settled", "true");
      const prompt = screen.getByRole("button", { name: promptName });
      fireEvent.click(prompt);

      expect(acquireWakeLock).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: promptName })).not.toBeInTheDocument();
      expect(screen.getByTitle("Slideshow")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("re-acquires the wake lock on a pointer gesture while it is inactive", async () => {
    // User gestures grant activation where Safari requires it, so a tap anywhere
    // on the shell while the lock is off must attempt a fresh acquire.
    mockWakeLockActive = false;
    global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

    render(<SlideshowShellScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    acquireWakeLock.mockClear();

    fireEvent.pointerDown(document.body);
    expect(acquireWakeLock).toHaveBeenCalled();
  });

  it("re-shows the one-tap wake gate after a sustained wake-lock loss", async () => {
    // A lock lost long after the launch tap must bring the affordance back so a
    // daytime user can restore it with a single tap.
    jest.useFakeTimers();
    try {
      mockWakeLockActive = false;
      global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

      render(<SlideshowShellScreen />);
      const promptName = "Tap once to keep this slideshow awake through code updates";

      await act(async () => {
        jest.advanceTimersByTime(AUTO_WAKE_SETTLE_MS);
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole("button", { name: promptName }));
      expect(screen.queryByRole("button", { name: promptName })).not.toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(WAKE_LOSS_RESET_MS);
        await Promise.resolve();
      });
      expect(screen.getByRole("button", { name: promptName })).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("restarts the sustained-loss window when the gate is dismissed part-way", async () => {
    // Dismissing the gate is a fresh user interaction: it must buy a full new
    // 60s window, not let the original window fire moments later. (This also
    // moves the wake-lock-failure e2e's flake horizon from settle+60s to
    // dismissal+60s.)
    jest.useFakeTimers();
    try {
      mockWakeLockActive = false;
      global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

      render(<SlideshowShellScreen />);
      const promptName = "Tap once to keep this slideshow awake through code updates";

      // Settle the auto-acquire window; the sustained-loss timer arms.
      await act(async () => {
        jest.advanceTimersByTime(AUTO_WAKE_SETTLE_MS);
        await Promise.resolve();
      });

      // Part-way through the loss window (t~=50s), dismiss the gate.
      await act(async () => {
        jest.advanceTimersByTime(WAKE_LOSS_RESET_MS - 10000);
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole("button", { name: promptName }));
      expect(screen.queryByRole("button", { name: promptName })).not.toBeInTheDocument();

      // Past where the ORIGINAL window would have fired (t~=61s): the gate must
      // NOT reappear, because dismissal restarted the clock.
      await act(async () => {
        jest.advanceTimersByTime(11000);
        await Promise.resolve();
      });
      expect(screen.queryByRole("button", { name: promptName })).not.toBeInTheDocument();

      // A full fresh window after dismissal (t~=110s): now it returns.
      await act(async () => {
        jest.advanceTimersByTime(WAKE_LOSS_RESET_MS);
        await Promise.resolve();
      });
      expect(screen.getByRole("button", { name: promptName })).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("persists wake events to the wake history log and renders them", async () => {
    mockWakeLockActive = true;
    global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

    const { rerender } = render(<SlideshowShellScreen />);

    // A true -> false transition records a "lost" event; a subsequent
    // false -> true records an "acquired" event.
    await act(async () => {
      mockWakeLockActive = false;
      rerender(<SlideshowShellScreen />);
    });
    await act(async () => {
      mockWakeLockActive = true;
      rerender(<SlideshowShellScreen />);
    });

    // An internal hook outcome (delivered through the subscription) is recorded.
    await act(async () => {
      wakeEventListener?.("cap-reached");
    });

    const stored = readShellLog(window.localStorage);
    expect(stored.map((entry) => entry.type)).toEqual(["lost", "acquired", "cap-reached"]);
    expect(stored.every((entry) => entry.category === "wake")).toBe(true);
    // The raw payload really is in localStorage under the shared key so it
    // survives a relaunch.
    expect(window.localStorage.getItem(SHELL_LOG_STORAGE_KEY)).toContain("cap-reached");

    // The diagnostics panel surfaces the history under a disclosure.
    fireEvent.click(screen.getByRole("button", { name: "Slideshow diagnostics" }));
    expect(screen.getByText("Event history")).toBeInTheDocument();
    expect(screen.getByText("Gave up retrying")).toBeInTheDocument();
  });

  it("records wake-lock losses in the diagnostics panel", async () => {
    mockWakeLockActive = true;
    global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

    const { rerender } = render(<SlideshowShellScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Slideshow diagnostics" }));
    expect(screen.getByText("Wake losses").parentElement).toHaveTextContent("0");

    await act(async () => {
      mockWakeLockActive = false;
      rerender(<SlideshowShellScreen />);
    });

    expect(screen.getByText("Wake losses").parentElement).toHaveTextContent("1");
    expect(screen.getByText(/last loss/)).toBeInTheDocument();
  });

  it("exits the outer shell when the slideshow runtime asks to leave", async () => {
    global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

    render(<SlideshowShellScreen />);
    const frame = screen.getByTitle("Slideshow");
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { type: "snapshots:slideshow-exit" },
        origin: window.location.origin,
        source: (frame as HTMLIFrameElement).contentWindow,
      }),
    );

    expect(mockNavigateTo).toHaveBeenCalledWith("/");
    await waitFor(() => expect(screen.getAllByText("Starting runtime")).not.toHaveLength(0));
  });

  it("shows compact code, connection and wake-lock diagnostics", async () => {
    global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

    render(<SlideshowShellScreen />);

    expect(screen.getByRole("group", { name: "Slideshow diagnostics" })).toBeInTheDocument();
    expect(screen.getByText("Screen awake")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    const frame = screen.getByTitle("Slideshow");
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { type: "snapshots:slideshow-ready", buildVersion: "build-current" },
        origin: window.location.origin,
        source: (frame as HTMLIFrameElement).contentWindow,
      }),
    );
    await waitFor(() => expect(screen.getByText("Code current")).toBeInTheDocument());
  });

  it("labels an unsupported wake lock accurately", async () => {
    mockWakeLockSupported = false;
    mockWakeLockActive = false;
    global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

    render(<SlideshowShellScreen />);

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Wake lock off")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Starting runtime")).not.toHaveLength(0));
  });

  it("does not claim cached code is current while offline", () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

    render(<SlideshowShellScreen />);
    const frame = screen.getByTitle("Slideshow");
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { type: "snapshots:slideshow-ready", buildVersion: "build-current" },
        origin: window.location.origin,
        source: (frame as HTMLIFrameElement).contentWindow,
      }),
    );

    expect(screen.getAllByText("Code check offline")).not.toHaveLength(0);
    expect(screen.queryByText("Code current")).not.toBeInTheDocument();
  });

  it("beats the heartbeat to storage without ever re-rendering", async () => {
    // The heartbeat proves the JS loop is alive for the gap detector, but a
    // days-long kiosk must not re-render once per minute forever. The interval
    // callback writes storage only — no setState — so advancing many beats (while
    // staying under the 5-minute version poll) must not add a single render.
    jest.useFakeTimers();
    try {
      mockWakeLockActive = true;
      global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;
      const onRender = jest.fn();

      render(
        <Profiler id="shell" onRender={onRender}>
          <SlideshowShellScreen />
        </Profiler>,
      );

      // Settle the auto-acquire window and let the initial version check resolve,
      // then mark the frame ready so the readiness-recovery timeout stays dormant
      // (it would otherwise reload the frame and re-render inside our window).
      await act(async () => {
        jest.advanceTimersByTime(AUTO_WAKE_SETTLE_MS);
        await Promise.resolve();
        await Promise.resolve();
      });
      const frame = screen.getByTitle("Slideshow");
      await act(async () => {
        fireEvent(
          window,
          new MessageEvent("message", {
            data: { type: "snapshots:slideshow-ready", buildVersion: "build-current" },
            origin: window.location.origin,
            source: (frame as HTMLIFrameElement).contentWindow,
          }),
        );
        await Promise.resolve();
      });

      const heartbeatAfterMount = window.localStorage.getItem(HEARTBEAT_STORAGE_KEY);
      expect(heartbeatAfterMount).not.toBeNull();
      const baselineRenders = onRender.mock.calls.length;

      // Four heartbeats (240s), staying under the 300s version poll so only the
      // heartbeat interval fires in this window.
      await act(async () => {
        jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 4);
        await Promise.resolve();
      });

      // Not one extra render from four beats.
      expect(onRender.mock.calls.length).toBe(baselineRenders);
      // The rolling key advanced (the beats really wrote), and no gap event was
      // recorded for these in-threshold beats.
      expect(window.localStorage.getItem(HEARTBEAT_STORAGE_KEY)).not.toBe(heartbeatAfterMount);
      expect(readShellLog(window.localStorage).some((entry) => entry.category === "gap")).toBe(
        false,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("records a gap event when the previous heartbeat is older than the freeze threshold", () => {
    // A pre-relaunch heartbeat left far in the past means the JS loop was frozen /
    // the device slept in between: the mount check must record a "not running"
    // gap event, distinguishing a freeze from a merely refused wake lock.
    global.fetch = jest.fn(pendingVersionResponse);
    const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
    window.localStorage.setItem(HEARTBEAT_STORAGE_KEY, String(threeHoursAgo));

    render(<SlideshowShellScreen />);

    const gap = readShellLog(window.localStorage).find((entry) => entry.category === "gap");
    expect(gap).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Slideshow diagnostics" }));
    expect(screen.getByText(/Page was not running for/)).toBeInTheDocument();
  });

  it("does not record a gap event for a heartbeat within the threshold", () => {
    global.fetch = jest.fn(pendingVersionResponse);
    window.localStorage.setItem(HEARTBEAT_STORAGE_KEY, String(Date.now() - 30_000));

    render(<SlideshowShellScreen />);

    expect(readShellLog(window.localStorage).some((entry) => entry.category === "gap")).toBe(false);
  });

  it("copies an on-demand diagnostics payload carrying an event and the build version", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

    render(<SlideshowShellScreen />);

    // Seed a known event into the timeline.
    await act(async () => {
      wakeEventListener?.("cap-reached");
    });

    fireEvent.click(screen.getByRole("button", { name: "Slideshow diagnostics" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload).toContain("Gave up retrying");
    expect(payload).toContain("build-current");
    // A transient confirmation replaces the label.
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
