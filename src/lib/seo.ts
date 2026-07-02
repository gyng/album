const DEFAULT_SITE_ORIGIN = "https://photos.awoo.party";

export type JsonLd = Record<string, unknown>;

export const getSiteOrigin = (): string => {
  const envOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL;

  if (!envOrigin) {
    return DEFAULT_SITE_ORIGIN;
  }

  if (envOrigin.startsWith("http://") || envOrigin.startsWith("https://")) {
    return envOrigin.replace(/\/$/, "");
  }

  return `https://${envOrigin.replace(/\/$/, "")}`;
};

export const getCanonicalUrl = (pathname = "/"): string => {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  // Percent-encode non-ASCII path characters so canonical/OG/feed URLs agree
  // byte-for-byte with the sitemap (which also runs encodeURI); e.g. an album
  // named "türkiye" must serialise identically everywhere. encodeURI is a
  // no-op for plain ASCII paths and preserves URL delimiters (:/?#&).
  return encodeURI(`${getSiteOrigin()}${normalizedPathname}`);
};

// Resolve a possibly-relative asset path (e.g. a photo srcset entry) to an
// absolute URL for OG/Twitter/JSON-LD consumers, which require absolute URLs.
// Already-absolute URLs (http(s)://, protocol-relative, data:) pass through.
export const resolveAbsoluteUrl = (url?: string): string | undefined => {
  if (!url) {
    return undefined;
  }
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:")) {
    return url;
  }
  return getCanonicalUrl(url);
};

export const getDefaultSocialImageUrl = (): string =>
  getCanonicalUrl("/social-preview.svg");

export const getDefaultSeo = () => ({
  siteName: "Snapshots",
  defaultTitle: "Snapshots",
  defaultDescription: "Snapshots from a better era",
  // Black to match the manifest/_document theme-color and the always-dark
  // slideshow chrome; a grey value tinted the iPad PWA status bar grey.
  themeColor: "#000000",
});

export const buildWebSiteJsonLd = (): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: getDefaultSeo().siteName,
  url: getCanonicalUrl("/"),
  description: getDefaultSeo().defaultDescription,
});

export const buildCollectionPageJsonLd = ({
  name,
  description,
  pathname,
  image,
}: {
  name: string;
  description: string;
  pathname: string;
  image?: string;
}): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name,
  description,
  url: getCanonicalUrl(pathname),
  ...(image ? { image } : {}),
});

export const buildBreadcrumbJsonLd = (
  items: Array<{ name: string; pathname: string }>,
): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: getCanonicalUrl(item.pathname),
  })),
});
