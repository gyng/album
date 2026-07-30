import raw from "../site.config.json";

export type SiteLink = {
  readonly label: string;
  readonly href: string;
};

export type SiteConfig = {
  readonly site: {
    readonly name: string;
    readonly shortName: string;
    readonly description: string;
    /** Absolute origin, no trailing slash. Deploy-time env may override it. */
    readonly origin: string;
    /** BCP 47 tag for `<html lang>`. */
    readonly language: string;
  };
  readonly branding: {
    readonly themeColor: string;
    readonly backgroundColor: string;
    /** Site-root-relative path, or an absolute URL. */
    readonly socialPreviewImage: string;
    readonly socialPreviewSubtitle: string;
  };
  readonly social: readonly SiteLink[];
  readonly map: {
    /** Public, referrer-restricted MapTiler key. Empty string means no provider. */
    readonly apiKey: string;
    /** Account-private custom style, or null when the fork has none. */
    readonly galleryStyleId: string | null;
    readonly defaultStyle: string;
  };
  readonly search: {
    readonly databaseUrl: string;
    readonly embeddingsDatabaseUrl: string;
  };
  readonly paths: {
    /**
     * Resolved relative to `src/`. Note this string is also a data-format
     * constant: the search database stores keys like `../albums/<name>/<file>`,
     * so changing it invalidates every indexed path.
     */
    readonly albumsDir: string;
  };
  readonly analytics: {
    readonly vercel: boolean;
  };
  readonly pwa: {
    readonly description: string;
    readonly startUrl: string;
  };
};

/**
 * This fork's identity. Authored, not derived — no `process`, no environment,
 * no I/O — so it is safe inside the browser-portable screen graph.
 *
 * The annotation below is deliberate: an annotated assignment is checked, so a
 * missing or mistyped key in site.config.json fails `npm run typecheck`. Do not
 * weaken it to `as SiteConfig`.
 */
export const siteConfig: SiteConfig = raw;
