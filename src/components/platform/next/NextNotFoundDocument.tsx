import "../../../styles/globals.css";
import { siteConfig } from "../../../lib/siteConfig";
import { THEME_BOOTSTRAP_SCRIPT } from "../../../util/themeBootstrap";
import { NextNotFoundRuntime } from "./NextNotFoundRuntime";

// The build-only App Router otherwise replaces the Pages Router's static 404.
// Keep document integration here and the recovery UI in its portable screen.
export default function NextNotFoundDocument() {
  return (
    <html lang={siteConfig.site.language} suppressHydrationWarning>
      {/* A standalone error document owns its head; Pages Router Head is unavailable. */}
      {/* oxlint-disable-next-line next/no-head-element */}
      <head>
        <title>Page not found</title>
        <meta name="robots" content="noindex" />
      </head>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <NextNotFoundRuntime />
      </body>
    </html>
  );
}
