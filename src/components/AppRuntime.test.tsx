/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppRuntime } from "./AppRuntime";
import { BrowserPlatformProvider } from "./platform/browser";

const clients: unknown[] = [];

const Probe = ({ label }: { label: string }) => {
  clients.push(useQueryClient());
  return <main>{label}</main>;
};

describe("portable application runtime", () => {
  afterEach(() => {
    clients.length = 0;
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("assembles with the browser renderer and owns cache state per application tree", async () => {
    const register = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    const first = render(
      <BrowserPlatformProvider>
        <AppRuntime telemetry={<span>Portable telemetry</span>}>
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

    expect(screen.getByRole("main")).toHaveTextContent("Second renderer");
    expect(clients.at(-1)).not.toBe(firstClient);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    expect(register).toHaveBeenCalledWith(expect.stringMatching(/^\/sw\.js\?v=.+/), {
      updateViaCache: "none",
    });
  });
});
