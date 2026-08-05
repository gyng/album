import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { DocumentHead } from "./platform";
import { ErrorBoundary } from "./ErrorBoundary";
import { BUILD_VERSION } from "../lib/buildVersion";
import { reloadCurrentPage } from "../util/navigate";
import styles from "./AppRuntime.module.css";

// Chunk-load failures after a redeploy surface either as a resource "error"
// event on the injected <script>/<link> (these do not bubble — capture is
// required to see them) or, for dynamic import(), as an unhandled rejection.
// Match the rejection conservatively against the well-known shapes: webpack's
// ChunkLoadError, and the standard browser/bundler messages for a failed
// dynamic import.
const isStaleChunkRejection = (reason: unknown): boolean => {
  const asError = reason as { name?: string; message?: string } | null | undefined;
  const name = asError?.name ?? "";
  if (name === "ChunkLoadError") {
    return true;
  }
  const message = typeof asError?.message === "string" ? asError.message : "";
  return /Loading (?:CSS )?chunk|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    message,
  );
};

// Only a first-party application build asset failing to load signals a
// redeploy. A cross-origin script/stylesheet, or Vercel's own platform
// analytics endpoints (/_vercel/insights, /_vercel/speed-insights), fail
// routinely — a privacy or ad blocker returns ERR_BLOCKED_BY_CLIENT for them on
// every single load — and treating those as a stale chunk latched a permanent
// "reload to continue" banner for anyone running a content blocker. Build
// chunks are served same-origin here (no assetPrefix/CDN), so origin plus the
// /_vercel/ carve-out is a reliable discriminator.
const isFirstPartyBuildAsset = (url: string): boolean => {
  if (typeof window === "undefined" || url === "") return false;
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return false;
  }
  if (parsed.origin !== window.location.origin) return false;
  return !parsed.pathname.startsWith("/_vercel/");
};

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
  const [staleDeploy, setStaleDeploy] = React.useState(false);
  // A chunk that fails to load while the device is offline is far more likely a
  // dropped connection / failed prefetch than an actual redeploy, so we must not
  // assert the site changed. Captured once, at first detection, alongside the
  // latch below.
  const [bannerOffline, setBannerOffline] = React.useState(false);
  // Latches on first detection so repeated failures never stack banners, and so
  // dismissing one does not let the next failed chunk reopen it.
  const staleDetectedRef = React.useRef(false);

  // The application says when it is live.
  //
  // Server-rendered markup is interactive-looking long before React attaches to
  // it: a control driven in that window takes a value hydration then discards,
  // which reads as a logic bug rather than a race (a picker set to "slate" that
  // reports "dark"). Tests wait on this attribute instead of guessing; nothing
  // in the application reads it, and its absence changes no behaviour.
  React.useEffect(() => {
    document.documentElement.dataset.appHydrated = "true";
    return () => {
      delete document.documentElement.dataset.appHydrated;
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const flagStaleDeploy = () => {
      if (staleDetectedRef.current) return;
      staleDetectedRef.current = true;
      setBannerOffline(navigator.onLine === false);
      setStaleDeploy(true);
    };

    const handleResourceError = (event: Event) => {
      const target = event.target as
        | (Element & { tagName?: string; rel?: string; src?: string; href?: string })
        | null;
      // Resource load errors target the failing element; a plain script error
      // targets window (no tagName) and must be ignored. Only a SCRIPT or a
      // STYLESHEET link indicates a missing chunk: prefetch/preload/icon links
      // fail routinely (cancelled route prefetches during navigation fire
      // error events too) and must never raise the banner — a benign prefetch
      // failure once parked this bar over the map's bottom controls in CI.
      const tagName = (target?.tagName ?? "").toUpperCase();
      const isStylesheet = tagName === "LINK" && (target?.rel ?? "").toLowerCase() === "stylesheet";
      if (tagName !== "SCRIPT" && !isStylesheet) {
        return;
      }
      // ...and only when the failing resource is a first-party build asset. A
      // blocked analytics script (/_vercel/insights) or any third-party script
      // is not a redeploy and must not raise the banner.
      const url = tagName === "LINK" ? (target?.href ?? "") : (target?.src ?? "");
      if (isFirstPartyBuildAsset(url)) {
        flagStaleDeploy();
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isStaleChunkRejection(event.reason)) {
        flagStaleDeploy();
      }
    };

    window.addEventListener("error", handleResourceError, true);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleResourceError, true);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

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
        {staleDeploy ? (
          <div className={styles.updateBanner} role="status" aria-live="polite">
            <span className={styles.updateBannerText}>
              {bannerOffline
                ? "Some parts of the site could not load — check the connection, then reload."
                : "This site may have been updated — reload to continue."}
            </span>
            <button
              type="button"
              className={styles.updateReloadButton}
              onClick={() => reloadCurrentPage()}
            >
              Reload
            </button>
            <button
              type="button"
              className={styles.updateDismissButton}
              aria-label="Dismiss"
              onClick={() => setStaleDeploy(false)}
            >
              ×
            </button>
          </div>
        ) : null}
        {telemetry}
        {children}
      </QueryClientProvider>
    </ErrorBoundary>
  );
};
