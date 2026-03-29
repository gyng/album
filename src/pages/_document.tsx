import Document, {
  Head,
  Html,
  Main,
  NextScript,
  type DocumentContext,
} from "next/document";

const themeInitScript = `
(() => {
  const applyTheme = (theme) => {
    const root = document.documentElement;
    const body = document.body;
    const isDark = theme === "dark";

    root.classList.toggle("dark", isDark);
    root.classList.toggle("light", !isDark);
    if (body) {
      body.classList.toggle("dark", isDark);
      body.classList.toggle("light", !isDark);
    }
  };

  try {
    const url = new URL(window.location.href);
    const theme = url.searchParams.get("theme");
    if (theme === "dark" || theme === "light") {
      applyTheme(theme);
      return;
    }

    const stored = JSON.parse(localStorage.getItem("darkMode") ?? "null");
    if (stored === true || stored === false) {
      applyTheme(stored ? "dark" : "light");
      return;
    }
  } catch (_err) {
    // Fall back to the default theme when storage or URL parsing is unavailable.
  }

  applyTheme("dark");
})();
`;

class MyDocument extends Document {
  static async getInitialProps(ctx: DocumentContext) {
    const initialProps = await Document.getInitialProps(ctx);
    return initialProps;
  }

  render() {
    return (
      <Html>
        <Head />
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
