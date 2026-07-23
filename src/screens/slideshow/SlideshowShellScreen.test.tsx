/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AUTO_WAKE_SETTLE_MS,
  RUNTIME_READY_TIMEOUT_MS,
  WAKE_LOSS_RESET_MS,
  SlideshowShellScreen,
} from "./SlideshowShellScreen";
import { RUNTIME_RELOAD_BASE_DELAY_MS } from "../../util/slideshowShell";
import { useWakeLock } from "../../components/useWakeLock";
import { navigateTo } from "../../util/navigate";

const acquireWakeLock = jest.fn().mockResolvedValue(undefined);
const releaseWakeLock = jest.fn().mockResolvedValue(undefined);
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

describe("slideshow code shell", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWakeLockSupported = true;
    mockWakeLockActive = true;
    mockUseWakeLock.mockImplementation(() => ({
      ref: { current: new EventTarget() },
      isSupported: mockWakeLockSupported,
      isActive: mockWakeLockActive,
      acquire: acquireWakeLock,
      release: releaseWakeLock,
    }));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.history.replaceState({}, "", "/slideshow/shell?filter=test-simple&delay=60");
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
    expect(releaseWakeLock).not.toHaveBeenCalled();
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
    } finally {
      jest.useRealTimers();
    }
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
});
