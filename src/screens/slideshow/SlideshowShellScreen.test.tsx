/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SlideshowShellScreen } from "./SlideshowShellScreen";
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

  it("forces a fresh frame when retrying the same pending build", async () => {
    global.fetch = jest
      .fn()
      .mockImplementationOnce(() => versionResponse("build-current"))
      .mockImplementationOnce(() => versionResponse("build-next"))
      .mockImplementationOnce(() => versionResponse("build-next")) as jest.Mock;

    render(<SlideshowShellScreen />);
    const firstFrame = screen.getByTitle("Slideshow");
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { type: "snapshots:slideshow-ready", buildVersion: "build-current" },
        origin: window.location.origin,
        source: (firstFrame as HTMLIFrameElement).contentWindow,
      }),
    );
    await waitFor(() => expect(screen.getByText("Code current")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Slideshow diagnostics" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for code update" }));

    await waitFor(() => expect(screen.getByTitle("Slideshow")).not.toBe(firstFrame));
    const secondFrame = screen.getByTitle("Slideshow");
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { type: "snapshots:slideshow-ready", buildVersion: "build-current" },
        origin: window.location.origin,
        source: (secondFrame as HTMLIFrameElement).contentWindow,
      }),
    );
    await waitFor(() => expect(screen.getAllByText("Update retry pending")).not.toHaveLength(0));
    fireEvent.click(screen.getByRole("button", { name: "Check for code update" }));

    await waitFor(() => expect(screen.getByTitle("Slideshow")).not.toBe(secondFrame));
  });

  it("removes the one-tap wake prompt even when acquisition remains inactive", async () => {
    mockWakeLockActive = false;
    global.fetch = jest.fn(() => versionResponse("build-current")) as jest.Mock;

    render(<SlideshowShellScreen />);

    const prompt = screen.getByRole("button", {
      name: "Tap once to keep this slideshow awake through code updates",
    });
    fireEvent.click(prompt);

    expect(acquireWakeLock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: prompt.textContent! })).not.toBeInTheDocument();
    expect(screen.getByTitle("Slideshow")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Starting runtime")).not.toHaveLength(0));
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
