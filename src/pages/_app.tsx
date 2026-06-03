import "../styles/globals.css";
import type { AppProps } from "next/app";
import { Analytics } from "@vercel/analytics/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import "./_app.css";

const queryClient = new QueryClient();

function MyApp({ Component, pageProps }: AppProps) {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    void navigator.serviceWorker.register("/sw.js");
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Analytics />
        <Component {...pageProps} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default MyApp;
