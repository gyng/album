import "../styles/globals.css";
import type { AppProps } from "next/app";
import { Analytics } from "@vercel/analytics/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Head from "next/head";
import "./_app.css";

function MyApp({ Component, pageProps }: AppProps) {
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <Head>
        <link rel="icon" href="/favicon.svg" key="favicon" />
        <meta name="theme-color" content="#2c2c2c" key="theme-color" />
      </Head>
      <Analytics />
      <Component {...pageProps} />
    </QueryClientProvider>
  );
}

export default MyApp;
