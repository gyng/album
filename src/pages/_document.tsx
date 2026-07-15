import Document, { Head, Html, Main, NextScript, type DocumentContext } from "next/document";
import { NAMED_THEMES, THEME_SCHEMES } from "../util/theme";

// Mirrored by the ThemeToggle effect — both must set the same classes.
const themeInitScript = `
(() => {
  const schemes = ${JSON.stringify(THEME_SCHEMES)};
  const named = ${JSON.stringify(NAMED_THEMES)};

  const applyTheme = (theme) => {
    const scheme = theme == null ? null : schemes[theme];
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      el.classList.toggle("light", scheme === "light");
      el.classList.toggle("dark", scheme === "dark");
      for (const name of named) {
        el.classList.toggle("theme-" + name, name === theme);
      }
    }
  };

  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("theme");
    if (fromUrl && Object.hasOwn(schemes, fromUrl)) {
      applyTheme(fromUrl);
      return;
    }

    const stored = localStorage.getItem("theme");
    if (stored && Object.hasOwn(schemes, stored)) {
      applyTheme(stored);
      return;
    }

    // Legacy boolean preference from the old light/dark-only toggle.
    const legacy = JSON.parse(localStorage.getItem("darkMode") ?? "null");
    if (legacy === true || legacy === false) {
      applyTheme(legacy ? "dark" : "light");
      return;
    }
  } catch (_err) {
    // Fall back to the system scheme when storage or URL parsing is unavailable.
  }

  // No explicit preference: clear theme classes so :root's
  // "color-scheme: light dark" follows the OS live.
  applyTheme(null);
})();
`;

class MyDocument extends Document {
  static async getInitialProps(ctx: DocumentContext) {
    const initialProps = await Document.getInitialProps(ctx);
    return initialProps;
  }

  render() {
    return (
      <Html lang="en-GB">
        <Head>
          <link rel="manifest" href="/manifest.webmanifest" />
          <meta name="theme-color" content="#000000" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black" />
          <meta name="mobile-web-app-capable" content="yes" />
        </Head>
        <body>
          <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
