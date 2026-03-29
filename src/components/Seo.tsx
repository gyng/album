import Head from "next/head";
import {
  getCanonicalUrl,
  getDefaultSeo,
  getDefaultSocialImageUrl,
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
};

export const Seo: React.FC<SeoProps> = ({
  title,
  description,
  pathname = "/",
  image,
  noindex = false,
  type = "website",
  jsonLd,
}) => {
  const defaults = getDefaultSeo();
  const resolvedTitle = title ?? defaults.defaultTitle;
  const resolvedDescription = description ?? defaults.defaultDescription;
  const canonicalUrl = getCanonicalUrl(pathname);
  const resolvedImage = image ?? getDefaultSocialImageUrl();
  const jsonLdItems = jsonLd == null ? [] : Array.isArray(jsonLd) ? jsonLd : [jsonLd];

  return (
    <Head>
      <title>{resolvedTitle}</title>
      <meta name="description" content={resolvedDescription} key="description" />
      <link rel="canonical" href={canonicalUrl} key="canonical" />
      <link rel="icon" href="/favicon.svg" key="favicon" />
      <meta name="theme-color" content={defaults.themeColor} key="theme-color" />
      <meta property="og:site_name" content={defaults.siteName} key="og:site_name" />
      <meta property="og:title" content={resolvedTitle} key="og:title" />
      <meta
        property="og:description"
        content={resolvedDescription}
        key="og:description"
      />
      <meta property="og:url" content={canonicalUrl} key="og:url" />
      <meta property="og:type" content={type} key="og:type" />
      <meta property="og:image" content={resolvedImage} key="og:image" />
      <meta name="twitter:card" content="summary_large_image" key="twitter:card" />
      <meta name="twitter:title" content={resolvedTitle} key="twitter:title" />
      <meta
        name="twitter:description"
        content={resolvedDescription}
        key="twitter:description"
      />
      <meta name="twitter:image" content={resolvedImage} key="twitter:image" />
      {noindex ? (
        <meta name="robots" content="noindex, nofollow" key="robots" />
      ) : null}
      {jsonLdItems.map((item, index) => (
        <script
          key={`jsonld-${index}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }}
        />
      ))}
    </Head>
  );
};
