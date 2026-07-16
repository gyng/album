/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppRuntime } from "./AppRuntime";
import { BrowserPlatformProvider } from "./platform/browser";

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
