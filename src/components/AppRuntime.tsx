import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { DocumentHead } from "./platform";
import { ErrorBoundary } from "./ErrorBoundary";
import { BUILD_VERSION } from "../lib/buildVersion";

type AppRuntimeProps = React.PropsWithChildren<{
  telemetry?: React.ReactNode;
}>;

/**
 * Renderer-neutral application shell. Framework entry points provide their
 * platform adapter outside this component and may inject renderer-specific
 * telemetry without making it part of the portable application graph.
 */
export const AppRuntime = ({ children, telemetry }: AppRuntimeProps) => {
  // Keep cache ownership with this application tree. A module singleton is
  // convenient for a client-only entry, but leaks request state if another
  // renderer mounts the shell independently for concurrent SSR requests.
  const [queryClient] = React.useState(() => new QueryClient());

  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const workerUrl = `/sw.js?v=${encodeURIComponent(BUILD_VERSION)}`;
    void navigator.serviceWorker.register(workerUrl, { updateViaCache: "none" }).catch((error) => {
      // PWA support is progressive enhancement; a registration failure must
      // not surface as an unhandled rejection or prevent the gallery loading.
      console.error("Service worker registration failed", error);
    });
  }, []);

  return (
    <ErrorBoundary>
      <DocumentHead>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </DocumentHead>
      <QueryClientProvider client={queryClient}>
        {telemetry}
        {children}
      </QueryClientProvider>
    </ErrorBoundary>
  );
};
