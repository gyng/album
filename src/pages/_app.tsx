import "../styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { AppRuntime } from "../components/AppRuntime";
import { NextPlatformProvider } from "../components/platform/next/NextPlatformProvider";
import "../styles/maplibre-overrides.css";

// Vercel Analytics' script only exists on the Vercel host: mounting it against
// a local `next start` or the CI e2e server 404s `/_vercel/insights/script.js`
// — a genuine script load error that trips AppRuntime's stale-deploy banner
// (which then blocks e2e clicks). Gate on hostname, decided client-side so the
// static export stays host-agnostic.
export const shouldEnableAnalytics = (hostname: string): boolean =>
  hostname !== "localhost" && hostname !== "127.0.0.1";

const HostGatedAnalytics = () => {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(shouldEnableAnalytics(window.location.hostname));
  }, []);
  return enabled ? <Analytics /> : null;
};

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <NextPlatformProvider>
      <AppRuntime telemetry={<HostGatedAnalytics />}>
        <Component {...pageProps} />
      </AppRuntime>
    </NextPlatformProvider>
  );
}

export default MyApp;
