/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppRuntime } from "./AppRuntime";
import { BrowserPlatformProvider } from "./platform/browser";
import { reloadCurrentPage } from "../util/navigate";

jest.mock("../util/navigate", () => ({
  reloadCurrentPage: jest.fn(),
}));

// Pin the build version so the registered URL can be asserted exactly. Matching
// it loosely would accept a constant version, which silently collapses every
// deploy into one cache generation — the stale-chunk accumulation the worker's
// generation cleanup exists to prevent.
jest.mock("../lib/buildVersion", () => ({ BUILD_VERSION: "test build/sha" }));

const clients: unknown[] = [];

const Probe = ({ label }: { label: string }) => {
  clients.push(useQueryClient());
  return <main>{label}</main>;
};

const withServiceWorker = () => {
  const register = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
  return register;
};

describe("portable application runtime", () => {
  afterEach(() => {
    clients.length = 0;
    Reflect.deleteProperty(navigator, "serviceWorker");
    Reflect.deleteProperty(navigator, "onLine");
  });

  it("registers the worker under the current build version", async () => {
    const register = withServiceWorker();

    render(
      <BrowserPlatformProvider>
        <AppRuntime>
          <Probe label="Gallery" />
        </AppRuntime>
      </BrowserPlatformProvider>,
    );

    // The worker derives its cache generation from this exact query parameter,
    // and encoding it is what keeps a version containing a slash or space from
    // being reinterpreted as a path or a second parameter.
    await waitFor(() =>
      expect(register).toHaveBeenCalledWith("/sw.js?v=test%20build%2Fsha", {
        updateViaCache: "none",
      }),
    );
  });

  it("skips registration where service workers are unavailable", async () => {
    render(
      <BrowserPlatformProvider>
        <AppRuntime>
          <Probe label="Gallery" />
        </AppRuntime>
      </BrowserPlatformProvider>,
    );

    expect(screen.getByRole("main")).toHaveTextContent("Gallery");
  });

  it("renders renderer-specific telemetry injected by the entry point", () => {
    withServiceWorker();

    render(
      <BrowserPlatformProvider>
        <AppRuntime telemetry={<span>Portable telemetry</span>}>
          <Probe label="Gallery" />
        </AppRuntime>
      </BrowserPlatformProvider>,
    );

    // Next injects <Analytics/> this way rather than importing it into the
    // portable graph, so dropping the prop would silently remove analytics.
    expect(screen.getByText("Portable telemetry")).toBeInTheDocument();
  });

  const dispatchResourceError = (target: EventTarget | null) => {
    const event = new Event("error");
    if (target) {
      Object.defineProperty(event, "target", { value: target });
    }
    act(() => {
      window.dispatchEvent(event);
    });
  };

  // Copy hedges to "may have been updated": a failed chunk is not proof of a
  // redeploy (an offline prefetch can fail too), so the banner must not state it
  // as fact.
  const bannerText = "This site may have been updated — reload to continue.";
  const offlineBannerText =
    "Some parts of the site could not load — check the connection, then reload.";

  const setOnline = (online: boolean) => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: online,
    });
  };

  it("shows a reload banner when a generated script fails to load", () => {
    withServiceWorker();

    render(
      <BrowserPlatformProvider>
        <AppRuntime>
          <Probe label="Gallery" />
        </AppRuntime>
      </BrowserPlatformProvider>,
    );

    expect(screen.queryByText(bannerText)).not.toBeInTheDocument();
    // Resource load errors do not bubble, so the shell listens in the capture
    // phase; the failing <script> is the event target.
    dispatchResourceError(document.createElement("script"));
    expect(screen.getByText(bannerText)).toBeInTheDocument();
  });

  it("shows connection-focused copy when the failure happens offline", () => {
    withServiceWorker();
    setOnline(false);

    render(
      <BrowserPlatformProvider>
        <AppRuntime>
          <Probe label="Gallery" />
        </AppRuntime>
      </BrowserPlatformProvider>,
    );

    dispatchResourceError(document.createElement("script"));
    // Offline: do not claim the site changed — point at the connection instead.
    expect(screen.getByText(offlineBannerText)).toBeInTheDocument();
    expect(screen.queryByText(bannerText)).not.toBeInTheDocument();
  });

  it("ignores a generic window error with no element target", () => {
    withServiceWorker();

    render(
      <BrowserPlatformProvider>
        <AppRuntime>
          <Probe label="Gallery" />
        </AppRuntime>
      </BrowserPlatformProvider>,
    );

    // A plain runtime error targets window, not a script/link element, and must
    // not be misread as a missing chunk.
    dispatchResourceError(null);
    expect(screen.queryByText(bannerText)).not.toBeInTheDocument();
  });

  it("dismisses the banner and does not reopen it on further failures", () => {
    withServiceWorker();

    render(
      <BrowserPlatformProvider>
        <AppRuntime>
          <Probe label="Gallery" />
        </AppRuntime>
      </BrowserPlatformProvider>,
    );

    dispatchResourceError(document.createElement("script"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(bannerText)).not.toBeInTheDocument();

    // Once shown, the banner latches — a later failed chunk is a no-op.
    dispatchResourceError(document.createElement("link"));
    expect(screen.queryByText(bannerText)).not.toBeInTheDocument();
  });

  it("reloads when the banner's Reload button is pressed", () => {
    withServiceWorker();

    render(
      <BrowserPlatformProvider>
        <AppRuntime>
          <Probe label="Gallery" />
        </AppRuntime>
      </BrowserPlatformProvider>,
    );

    dispatchResourceError(document.createElement("script"));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reloadCurrentPage).toHaveBeenCalled();
  });

  it("owns cache state per application tree", () => {
    withServiceWorker();

    const first = render(
      <BrowserPlatformProvider>
        <AppRuntime>
          <Probe label="First renderer" />
        </AppRuntime>
      </BrowserPlatformProvider>,
    );
    const firstClient = clients.at(-1);
    first.unmount();

    render(
      <BrowserPlatformProvider>
        <AppRuntime>
          <Probe label="Second renderer" />
        </AppRuntime>
      </BrowserPlatformProvider>,
    );

    // A module-level singleton would leak request state between trees when a
    // renderer mounts the shell independently for concurrent SSR requests.
    expect(screen.getByRole("main")).toHaveTextContent("Second renderer");
    expect(clients.at(-1)).not.toBe(firstClient);
  });
});
