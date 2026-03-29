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
  return `${getSiteOrigin()}${normalizedPathname}`;
};

export const getDefaultSocialImageUrl = (): string =>
  getCanonicalUrl("/social-preview.svg");

export const getDefaultSeo = () => ({
  siteName: "Snapshots",
  defaultTitle: "Snapshots",
  defaultDescription: "Snapshots from a better era",
  themeColor: "#2c2c2c",
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
