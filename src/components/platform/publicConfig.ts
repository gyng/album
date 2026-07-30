import { siteConfig } from "../../lib/siteConfig";
import type { PublicConfig } from "./types";

export type { PublicConfig } from "./types";

/**
 * Renderer-neutral defaults used by the native browser adapter, derived from
 * the fork's authored identity. Hosts that vary per deployment (a Vercel
 * preview, an E2E build) overlay environment values on top of these.
 */
export const publicConfig: PublicConfig = {
  siteOrigin: siteConfig.site.origin,
  searchDatabaseUrl: siteConfig.search.databaseUrl,
  searchEmbeddingsDatabaseUrl: siteConfig.search.embeddingsDatabaseUrl,
};
