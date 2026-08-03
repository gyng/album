const path = require("path");
const { resolveSiteOrigin, siteConfig } = require("./bin/siteConfig.cjs");

const isVercelBuild = process.env.VERCEL === "1";
const hasExternalTypecheck = process.env.ALBUM_SKIP_NEXT_TYPECHECK === "1";
const distDir = process.env.NEXT_DIST_DIR ?? ".next";
const isE2eBuild = distDir === ".next-e2e";
const searchDatabaseUrl =
  process.env.NEXT_PUBLIC_SEARCH_DATABASE_URL ?? siteConfig.search.databaseUrl;
const searchEmbeddingsDatabaseUrl =
  process.env.NEXT_PUBLIC_SEARCH_EMBEDDINGS_DATABASE_URL ?? siteConfig.search.embeddingsDatabaseUrl;
const siteOrigin = resolveSiteOrigin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir,
  // Turbopack can otherwise leave these client-side lookups as runtime
  // `process.env` access. Declare them here so each build embeds the selected
  // production or isolated E2E database URLs.
  env: {
    NEXT_PUBLIC_SITE_URL: siteOrigin,
    NEXT_PUBLIC_SEARCH_DATABASE_URL: searchDatabaseUrl,
    NEXT_PUBLIC_SEARCH_EMBEDDINGS_DATABASE_URL: searchEmbeddingsDatabaseUrl,
  },
  staticPageGenerationTimeout: 300,
  outputFileTracingRoot: isVercelBuild ? __dirname : path.join(__dirname, ".."),
  serverExternalPackages: ["exifr", "sharp", "ffmpeg-static", "ffprobe-static"],
  // `npm run build` runs the repository's native TypeScript checker first.
  // Keep direct `next build` invocations safe by skipping Next's slower check
  // only when that explicit gate has completed successfully.
  typescript: {
    ignoreBuildErrors: hasExternalTypecheck,
    tsconfigPath: isE2eBuild ? "tsconfig.e2e.json" : "tsconfig.next.json",
  },
  headers: async () => [
    {
      source: "/feed.xml",
      headers: [{ key: "Content-Type", value: "application/rss+xml; charset=utf-8" }],
    },
    {
      source: "/album/:slug/feed.xml",
      headers: [{ key: "Content-Type", value: "application/rss+xml; charset=utf-8" }],
    },
    {
      source: "/sitemap.xml",
      headers: [{ key: "Content-Type", value: "application/xml; charset=utf-8" }],
    },
    {
      // Resized variants are derived artifacts under size-versioned (not
      // content-versioned) URLs. Without this, Vercel's default
      // `max-age=0, must-revalidate` blocks every image paint on a
      // conditional request even when the file is in the browser cache, so
      // whole grids visibly re-load on each visit. Serve-stale keeps repeat
      // visits painting from cache; a regenerated variant under the same name
      // converges within a week or one background revalidation.
      source: "/data/albums/:album/.resized_images/:file",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=604800, stale-while-revalidate=2592000",
        },
      ],
    },
  ],
  experimental: {
    scrollRestoration: true,
    useLightningcss: true,
    lightningCssFeatures: {
      exclude: ["light-dark"],
    },
  },
  outputFileTracingExcludes: {
    "**": [
      "node_modules/ffmpeg-static/**",
      "node_modules/ffprobe-static/**",
      "node_modules/@img/**",
      "node_modules/sharp/**",
      "node_modules/@sqlite.org/**",
      "public/data/**",
      "test/**",
    ],
  },
};

module.exports = nextConfig;
