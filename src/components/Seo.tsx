import { DocumentHead, usePublicConfig } from "./platform";
import {
  getCanonicalUrl,
  getDefaultSeo,
  getDefaultSocialImageUrl,
  resolveAbsoluteUrl,
  type JsonLd,
} from "../lib/seo";

type SeoProps = {
  title?: string;
  description?: string;
  pathname?: string;
  image?: string;
  noindex?: boolean;
  type?: "website" | "article";
  jsonLd?: JsonLd | JsonLd[];
  extraFeeds?: Array<{ title: string; href: string }>;
};

export const Seo: React.FC<SeoProps> = ({
  title,
  description,
  pathname = "/",
  image,
  noindex = false,
  type = "website",
  jsonLd,
  extraFeeds = [],
}) => {
  const { siteOrigin } = usePublicConfig();
  const defaults = getDefaultSeo();
  const resolvedTitle = title ?? defaults.defaultTitle;
  const resolvedDescription = description ?? defaults.defaultDescription;
  const canonicalUrl = getCanonicalUrl(pathname, siteOrigin);
  // OG/Twitter scrapers require absolute image URLs; a page-relative srcset
  // path (e.g. "/data/albums/…") is resolved against the site origin here.
  const resolvedImage =
    resolveAbsoluteUrl(image, siteOrigin) ?? getDefaultSocialImageUrl(siteOrigin);
  const jsonLdItems = jsonLd == null ? [] : Array.isArray(jsonLd) ? jsonLd : [jsonLd];

  return (
    <DocumentHead>
      <title>{resolvedTitle}</title>
      <meta name="description" content={resolvedDescription} key="description" />
      <link rel="canonical" href={canonicalUrl} key="canonical" />
      <link rel="icon" href="/favicon.svg" key="favicon" />
      <link
        rel="alternate"
        type="application/rss+xml"
        title={`${defaults.siteName} RSS Feed`}
        href={getCanonicalUrl("/feed.xml", siteOrigin)}
        key="rss-feed"
      />
      {extraFeeds.map((feed, index) => (
        <link
          rel="alternate"
          type="application/rss+xml"
          title={feed.title}
          href={feed.href}
          key={`extra-rss-feed-${index}`}
        />
      ))}
      <meta name="theme-color" content={defaults.themeColor} key="theme-color" />
      <meta property="og:site_name" content={defaults.siteName} key="og:site_name" />
      <meta property="og:title" content={resolvedTitle} key="og:title" />
      <meta property="og:description" content={resolvedDescription} key="og:description" />
      <meta property="og:url" content={canonicalUrl} key="og:url" />
      <meta property="og:type" content={type} key="og:type" />
      <meta property="og:image" content={resolvedImage} key="og:image" />
      <meta name="twitter:card" content="summary_large_image" key="twitter:card" />
      <meta name="twitter:title" content={resolvedTitle} key="twitter:title" />
      <meta name="twitter:description" content={resolvedDescription} key="twitter:description" />
      <meta name="twitter:image" content={resolvedImage} key="twitter:image" />
      {noindex ? <meta name="robots" content="noindex, nofollow" key="robots" /> : null}
      {jsonLdItems.map((item, index) => (
        <script
          key={`jsonld-${index}`}
          type="application/ld+json"
          // Escape "<" so a "</script>" inside album metadata cannot break out
          // of the script element (JSON-LD injection).
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(item).replace(/</g, "\\u003c"),
          }}
        />
      ))}
    </DocumentHead>
  );
};
