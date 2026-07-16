import type { PublicConfig } from "./types";

export type { PublicConfig } from "./types";

/** Renderer-neutral defaults used by the native browser adapter. */
export const publicConfig: PublicConfig = {
  siteOrigin: "https://photos.awoo.party",
  searchDatabaseUrl: "/search.sqlite",
  searchEmbeddingsDatabaseUrl: "/search-embeddings.sqlite",
};
