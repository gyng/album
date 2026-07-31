import { siteConfig } from "./siteConfig";

export const DEFAULT_SITE_ORIGIN = siteConfig.site.origin;

export const SITE_NAME = siteConfig.site.name;

const TITLE_SEPARATOR = " | ";

/**
 * "Map" becomes "Map | Snapshots"; nothing becomes "Snapshots". The single
 * place a page title is joined to the site's name, so a fork renames once.
 */
export const formatPageTitle = (pageTitle?: string): string =>
  pageTitle && pageTitle !== SITE_NAME ? `${pageTitle}${TITLE_SEPARATOR}${SITE_NAME}` : SITE_NAME;

export type JsonLd = Record<string, unknown>;

export const getSiteOrigin = (configuredOrigin?: string): string => {
  if (!configuredOrigin) {
    return DEFAULT_SITE_ORIGIN;
  }

  if (configuredOrigin.startsWith("http://") || configuredOrigin.startsWith("https://")) {
    return configuredOrigin.replace(/\/$/, "");
  }

  return `https://${configuredOrigin.replace(/\/$/, "")}`;
};

export const getCanonicalUrl = (pathname = "/", siteOrigin = DEFAULT_SITE_ORIGIN): string => {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  // Percent-encode non-ASCII path characters so canonical/OG/feed URLs agree
  // byte-for-byte with the sitemap (which also runs encodeURI); e.g. an album
  // named "türkiye" must serialise identically everywhere. encodeURI is a
  // no-op for plain ASCII paths and preserves URL delimiters (:/?#&).
  return encodeURI(`${getSiteOrigin(siteOrigin)}${normalizedPathname}`);
};

// Resolve a possibly-relative asset path (e.g. a photo srcset entry) to an
// absolute URL for OG/Twitter/JSON-LD consumers, which require absolute URLs.
// Already-absolute URLs (http(s)://, protocol-relative, data:) pass through.
export const resolveAbsoluteUrl = (
  url?: string,
  siteOrigin = DEFAULT_SITE_ORIGIN,
): string | undefined => {
  if (!url) {
    return undefined;
  }
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:")) {
    return url;
  }
  return getCanonicalUrl(url, siteOrigin);
};

export const getDefaultSocialImageUrl = (siteOrigin = DEFAULT_SITE_ORIGIN): string =>
  getCanonicalUrl(siteConfig.branding.socialPreviewImage, siteOrigin);

export const getDefaultSeo = () => ({
  siteName: siteConfig.site.name,
  defaultTitle: siteConfig.site.name,
  defaultDescription: siteConfig.site.description,
  // Black to match the manifest/_document theme-color and the always-dark
  // slideshow chrome; a grey value tinted the iPad PWA status bar grey.
  themeColor: siteConfig.branding.themeColor,
});

export const buildWebSiteJsonLd = (siteOrigin = DEFAULT_SITE_ORIGIN): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: getDefaultSeo().siteName,
  url: getCanonicalUrl("/", siteOrigin),
  description: getDefaultSeo().defaultDescription,
});

export const buildCollectionPageJsonLd = (
  {
    name,
    description,
    pathname,
    image,
  }: {
    name: string;
    description: string;
    pathname: string;
    image?: string;
  },
  siteOrigin = DEFAULT_SITE_ORIGIN,
): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name,
  description,
  url: getCanonicalUrl(pathname, siteOrigin),
  ...(image ? { image } : {}),
});

export const buildBreadcrumbJsonLd = (
  items: Array<{ name: string; pathname: string }>,
  siteOrigin = DEFAULT_SITE_ORIGIN,
): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: getCanonicalUrl(item.pathname, siteOrigin),
  })),
});
