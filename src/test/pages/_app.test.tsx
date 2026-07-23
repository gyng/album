/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import MyApp, { shouldEnableAnalytics } from "../../pages/_app";

jest.mock("../../components/platform/next/NextPlatformProvider", () => ({
  NextPlatformProvider: ({ children }: React.PropsWithChildren) => children,
}));

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@vercel/analytics/react", () => ({
  Analytics: () => <span data-testid="analytics" />,
}));

jest.mock("../../components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const Page = ({ greeting }: { greeting: string }) => <main>{greeting}</main>;

describe("custom application", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("renders the requested page without requiring service-worker support", () => {
    render(
      <MyApp
        Component={Page as never}
        pageProps={{ greeting: "Hello gallery" }}
        router={{} as never}
      />,
    );

    expect(screen.getByRole("main")).toHaveTextContent("Hello gallery");
    // jsdom runs on localhost, where the host gate keeps Vercel Analytics
    // unmounted: its script only exists on the production host, and the 404 it
    // causes elsewhere used to raise the stale-deploy banner in e2e runs.
    expect(screen.queryByTestId("analytics")).not.toBeInTheDocument();
  });

  it("enables analytics only away from local hosts", () => {
    expect(shouldEnableAnalytics("localhost")).toBe(false);
    expect(shouldEnableAnalytics("127.0.0.1")).toBe(false);
    expect(shouldEnableAnalytics("photos.awoo.party")).toBe(true);
  });

  it("registers the application service worker when the browser supports it", async () => {
    const register = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    render(
      <MyApp Component={Page as never} pageProps={{ greeting: "Ready" }} router={{} as never} />,
    );

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith(expect.stringMatching(/^\/sw\.js\?v=.+/), {
        updateViaCache: "none",
      }),
    );
  });
});
