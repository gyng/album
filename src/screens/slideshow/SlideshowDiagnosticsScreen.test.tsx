/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SlideshowDiagnosticsScreen } from "./SlideshowDiagnosticsScreen";
import {
  SHELL_LOG_STORAGE_KEY,
  SHELL_STATUS_STORAGE_KEY,
  type ShellLogEntry,
  type ShellStatusSnapshot,
} from "../../util/shellDiagnosticsLog";

jest.mock("../../lib/buildVersion", () => ({ BUILD_VERSION: "build-current" }));

const NOW = Date.UTC(2026, 6, 23, 8, 0, 0);

const seedStatus = (overrides: Partial<ShellStatusSnapshot> = {}) => {
  const status: ShellStatusSnapshot = {
    at: NOW - 60000,
    sessionStart: NOW - 43200000,
    shellVersion: "build-current",
    runtimeVersion: "build-runtime",
    codeStatus: "current",
    online: true,
    wake: { supported: true, active: false, losses: 4 },
    ...overrides,
  };
  window.localStorage.setItem(SHELL_STATUS_STORAGE_KEY, JSON.stringify(status));
};

const seedLog = (entries: ShellLogEntry[]) => {
  window.localStorage.setItem(SHELL_LOG_STORAGE_KEY, JSON.stringify(entries));
};

describe("slideshow diagnostics page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports the wake-lock state and loss count the shell last recorded", () => {
    seedStatus();
    render(<SlideshowDiagnosticsScreen />);

    const wake = screen.getByRole("group", { name: "Screen wake lock" });
    expect(within(wake).getByText("Wake lock off")).toBeInTheDocument();
    expect(within(wake).getByText("4")).toBeInTheDocument();
  });

  it("lists the persisted event history newest first, with repeats and freeze gaps", () => {
    seedStatus();
    seedLog([
      { at: NOW - 7200000, category: "gap", type: "gap", durationMs: 8100000 },
      { at: NOW - 3600000, category: "wake", type: "lost" },
      {
        at: NOW - 1800000,
        category: "wake",
        type: "reacquire-failed",
        count: 47,
        lastAt: NOW - 60000,
      },
    ]);
    render(<SlideshowDiagnosticsScreen />);

    const events = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(events[0]).toContain("Re-acquire attempt failed");
    expect(events[0]).toContain("×47");
    expect(events[1]).toContain("Screen lock lost");
    expect(events[2]).toContain("Page was not running for 2 hours 15 minutes");
  });

  it("explains that nothing has been recorded when the log is empty", () => {
    render(<SlideshowDiagnosticsScreen />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/no events recorded/i)).toBeInTheDocument();
  });

  it("shares the full report through the system share sheet when one is available", async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    seedStatus();
    seedLog([{ at: NOW - 3600000, category: "wake", type: "lost" }]);
    render(<SlideshowDiagnosticsScreen />);

    fireEvent.click(screen.getByRole("button", { name: /share report/i }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const text = share.mock.calls[0]?.[0]?.text as string;
    expect(text).toContain("Shell build: build-current");
    expect(text).toContain("Screen lock lost");
    Reflect.deleteProperty(navigator, "share");
  });

  it("falls back to copying when the device has no share sheet", async () => {
    Reflect.deleteProperty(navigator, "share");
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    seedStatus();
    render(<SlideshowDiagnosticsScreen />);

    expect(screen.queryByRole("button", { name: /share report/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /copy report/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toContain("Runtime build: build-runtime");
  });

  it("offers a way back to the running slideshow", () => {
    render(<SlideshowDiagnosticsScreen />);
    expect(screen.getByRole("link", { name: /back to the slideshow/i })).toHaveAttribute(
      "href",
      "/slideshow/shell",
    );
  });

  it("says so when the shell has never reported its state", () => {
    render(<SlideshowDiagnosticsScreen />);
    const wake = screen.getByRole("group", { name: "Screen wake lock" });
    expect(within(wake).getByText(/not reported yet/i)).toBeInTheDocument();
  });
});
