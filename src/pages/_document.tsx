import Document, { Head, Html, Main, NextScript, type DocumentContext } from "next/document";
import { siteConfig } from "../lib/siteConfig";
import { THEME_BOOTSTRAP_SCRIPT } from "../util/themeBootstrap";

class MyDocument extends Document {
  static override async getInitialProps(ctx: DocumentContext) {
    const initialProps = await Document.getInitialProps(ctx);
    return initialProps;
  }

  override render() {
    return (
      <Html lang={siteConfig.site.language}>
        <Head>
          <link rel="manifest" href="/manifest.webmanifest" />
          <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
          <meta name="theme-color" content={siteConfig.branding.themeColor} />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black" />
          <meta name="mobile-web-app-capable" content="yes" />
        </Head>
        <body>
          <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
