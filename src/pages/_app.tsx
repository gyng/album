import "../styles/globals.css";
import type { AppProps } from "next/app";
import { Analytics } from "@vercel/analytics/react";
import { AppRuntime } from "../components/AppRuntime";
import { NextPlatformProvider } from "../components/platform/next/NextPlatformProvider";
import "../styles/maplibre-overrides.css";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <NextPlatformProvider>
      <AppRuntime telemetry={<Analytics />}>
        <Component {...pageProps} />
      </AppRuntime>
    </NextPlatformProvider>
  );
}

export default MyApp;
