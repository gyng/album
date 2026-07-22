/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AUTO_WAKE_SETTLE_MS,
  RUNTIME_READY_TIMEOUT_MS,
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

      await act(async () => {
        jest.advanceTimersByTime(AUTO_WAKE_SETTLE_MS);
        await Promise.resolve();
      });

      const prompt = screen.getByRole("button", { name: promptName });
      fireEvent.click(prompt);

      expect(acquireWakeLock).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: promptName })).not.toBeInTheDocument();
      expect(screen.getByTitle("Slideshow")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
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
